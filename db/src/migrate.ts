import "./loadenv.js";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * Minimal forward-only SQL migration runner. Applies every *.sql file in db/migrations
 * (lexical order) that hasn't been recorded in _migrations. Each file runs in its own
 * transaction. We hand-author SQL (rather than drizzle-kit generate) so we control the
 * pg_trgm extension + GIN indexes (§5.1).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "migrations");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const sql = postgres(connectionString, { max: 1 });

  try {
    await sql`CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;

    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM _migrations`).map((r) => r.name),
    );

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const content = readFileSync(join(migrationsDir, file), "utf8");
      process.stdout.write(`→ applying ${file} ... `);
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });
      process.stdout.write("done\n");
      count++;
    }

    if (count === 0) console.log("✓ migrations up to date");
    else console.log(`✓ applied ${count} migration(s)`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
