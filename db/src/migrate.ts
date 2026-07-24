import "./loadenv.js";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * File-based Postgres migration runner.
 *
 * WHY THIS EXISTS
 * ---------------
 * Migrations under db/migrations are plain, hand-written .sql files applied in
 * numeric order (0001, 0002, ...). Every applied file is recorded in the
 * `_migrations` table INSIDE the target database, so each environment (local /
 * dev / prod) knows exactly where it is and only ever runs what it hasn't run.
 *
 * We hand-author SQL (rather than `drizzle-kit generate`/`push`) so we control
 * the pg_trgm extension + GIN indexes, and because push introspects the live DB
 * and auto-generates DROP/ALTER statements to close the gap — which can silently
 * delete columns/data. This runner executes ONLY the literal SQL you wrote. If
 * your file doesn't say DROP, nothing drops.
 *
 * COMMANDS
 *   pnpm db:migrate            (alias `up`)  apply every pending migration in order
 *   pnpm db:migrate:status     show applied vs pending (read-only; a dry run)
 *   pnpm db:migrate:doctor     verify the live schema has the objects recent
 *                              migrations should have created (read-only)
 *   pnpm db:migrate:baseline   record ALL current files as applied WITHOUT running
 *                              them — one-time, for a DB that already has the schema
 *
 * SAFETY
 *   * Each migration runs in its own transaction (unless it uses CONCURRENTLY,
 *     which Postgres forbids inside a transaction). A failing statement rolls the
 *     whole file back — never a half-applied migration.
 *   * Destructive files (DROP TABLE/COLUMN, TRUNCATE) are refused unless you pass
 *     --allow-destructive (or set ALLOW_DESTRUCTIVE=true). Data loss must be a
 *     conscious, visible act — never an accident of a routine deploy.
 *   * A SHA-256 checksum of each applied file is stored; editing an already-applied
 *     migration is detected and warned about (migration history should be immutable).
 *
 * NOTE ON THE TABLE NAME: it is `_migrations`, not `schema_migrations`. Both dev
 * and prod already carry 24 recorded rows in `_migrations` from the original
 * minimal runner — renaming would make every one of them look pending and replay
 * history onto a live database.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
// MIGRATIONS_DIR overrides the default for the rare case of running from
// elsewhere; otherwise it is always db/migrations next to this file.
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  ? resolve(process.env.MIGRATIONS_DIR)
  : join(__dirname, "..", "migrations");

// Matches only genuinely destructive schema operations. DELETE FROM is
// intentionally NOT here — data migrations legitimately delete rows (0019 and
// 0024 both do), and flagging every one of those would train people to ignore
// the guard.
const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE)\b/i;

// CREATE INDEX CONCURRENTLY (and a few other statements) cannot run inside a
// transaction block, so such a file is executed without the BEGIN/COMMIT wrapper.
const NON_TRANSACTIONAL = /\bCONCURRENTLY\b/i;

type Cmd = "up" | "status" | "baseline" | "doctor";

// Schema markers for `doctor`: observable objects that recent migrations leave
// behind. Baseline blindly stamps files as applied, so BEFORE baselining an
// existing box, doctor verifies the schema really contains what those files
// created. `absent: true` inverts the check (the migration REMOVED the object).
// Extend this list when a new migration adds a checkable object.
// postgres.js prints every server NOTICE as a raw object. Our own idempotent
// DDL ("relation _migrations already exists, skipping") would then spam the log
// on EVERY run and bury the actual result. Swallow only the "already exists,
// skipping" family that CREATE/ALTER ... IF NOT EXISTS produces by design —
// anything else (including DROP ... IF EXISTS skips, which Postgres reports
// under the generic 00000, and any RAISE NOTICE a migration emits) still
// reaches the operator.
const EXPECTED_NOTICE_CODES = new Set([
  "42P07", // duplicate_table
  "42701", // duplicate_column
  "42710", // duplicate_object (index, constraint, type, enum value)
  "42P06", // duplicate_schema
]);

const DOCTOR_MARKERS: Array<{
  migration: string;
  table: string;
  column?: string; // omitted = check the table itself exists
  index?: string; // set = check a named index exists (pg_indexes)
  absent?: boolean;
}> = [
  { migration: "0016_smartplan_transactions", table: "smartplan_transactions" },
  { migration: "0018_apollo_leads", table: "leads" },
  { migration: "0019_db_storage_org_branding", table: "file_blobs" },
  { migration: "0019_db_storage_org_branding", table: "organizations", column: "light_logo_key" },
  { migration: "0021_referral_opportunity_dedupe", table: "opportunities", index: "opportunities_referral_dedupe_idx" },
  { migration: "0022_smartplan_txn_company", table: "smartplan_transactions", column: "company_name" },
  { migration: "0024_takeover_rework", table: "opportunities", column: "company_key" },
  { migration: "0024_takeover_rework", table: "transactions", column: "voided_at" },
  { migration: "0024_takeover_rework", table: "claim_requests", column: "matched_on" },
];

type Sql = ReturnType<typeof postgres>;

interface MigrationFile {
  filename: string;
  sql: string;
  checksum: string;
  destructive: boolean;
  transactional: boolean;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function loadMigrationFiles(): MigrationFile[] {
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    // Filenames are zero-padded (0001, 0002, ...), so a plain lexicographic
    // sort is also the correct numeric order — and tolerates gaps.
    .sort();

  return names.map((filename) => {
    // Strip a UTF-8 BOM if present — some editors add one and it breaks the
    // first SQL statement.
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8").replace(/^﻿/, "");
    return {
      filename,
      sql,
      checksum: sha256(sql),
      destructive: DESTRUCTIVE.test(sql),
      transactional: !NON_TRANSACTIONAL.test(sql),
    };
  });
}

// Creates the tracking table if missing, and adds the checksum column to the
// table shape the original minimal runner created (name + applied_at only).
// Nullable on purpose: the 24 rows recorded before checksums existed keep NULL
// and are simply excluded from drift detection rather than being back-stamped
// with today's file contents (which would defeat the whole point).
async function ensureTable(sql: Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await sql.unsafe(`ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text;`);
}

async function appliedMap(sql: Sql): Promise<Map<string, string | null>> {
  const rows = await sql<{ name: string; checksum: string | null }[]>`
    SELECT name, checksum FROM _migrations
  `;
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

// True if the target DB already contains application tables (any public table
// other than our own tracking table). Used to detect an existing box that has
// the schema but was never baselined — replaying history onto it would try to
// re-create objects that already exist and re-run data migrations.
async function hasExistingSchema(sql: Sql): Promise<boolean> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name <> '_migrations'
  `;
  return (rows[0]?.n ?? 0) > 0;
}

// Warn (do not fail) when an already-applied file's content has changed since it
// was recorded — migration history is supposed to be immutable. Rows with a NULL
// checksum predate checksum tracking and are skipped.
function warnOnDrift(files: MigrationFile[], applied: Map<string, string | null>): void {
  for (const f of files) {
    const recorded = applied.get(f.filename);
    if (recorded && recorded !== f.checksum) {
      console.warn(`  ⚠️  ${f.filename} changed since it was applied (checksum drift)`);
    }
  }
}

async function cmdStatus(sql: Sql): Promise<void> {
  const files = loadMigrationFiles();
  const applied = await appliedMap(sql);
  warnOnDrift(files, applied);

  const pending = files.filter((f) => !applied.has(f.filename));
  console.log(`\n${applied.size} applied · ${pending.length} pending · ${files.length} total\n`);
  if (pending.length === 0) {
    console.log("  ✓ database is up to date");
    return;
  }
  console.log("Pending:");
  for (const f of pending) {
    console.log(`  • ${f.filename}${f.destructive ? "   ⚠️  DESTRUCTIVE (DROP/TRUNCATE)" : ""}`);
  }
  console.log("");
}

async function cmdBaseline(sql: Sql): Promise<void> {
  // Mirror of cmdUp's un-baselined guard: baseline stamps files as applied
  // WITHOUT running them, so it is only ever valid on a DB that already has the
  // schema. On a fresh/empty DB it would mark everything done while nothing
  // exists — every later `up` would then say "up to date" against an empty
  // schema, silently. Refuse; a fresh DB must run `up` instead.
  if (!(await hasExistingSchema(sql))) {
    console.error(
      "\n✋ Refusing to baseline: this database has no application tables.\n" +
        "   Baseline records existing files as applied WITHOUT running them — it is\n" +
        "   only for a box whose schema was already created (e.g. by hand-applied\n" +
        "   psql before this runner existed). A fresh, empty database must run\n" +
        "   `up` instead so the migrations actually execute.\n",
    );
    process.exit(1);
  }

  const files = loadMigrationFiles();
  const applied = await appliedMap(sql);
  const toStamp = files.filter((f) => !applied.has(f.filename));

  if (toStamp.length === 0) {
    console.log("Nothing to baseline — every migration is already recorded.");
    return;
  }
  // One transaction for the whole set: a mid-loop interruption must not leave a
  // partially-stamped table (applied.size > 0 would disarm the un-baselined
  // guard while most of history is still unrecorded).
  await sql.begin(async (tx) => {
    for (const f of toStamp) {
      await tx`
        INSERT INTO _migrations (name, checksum) VALUES (${f.filename}, ${f.checksum})
        ON CONFLICT (name) DO NOTHING
      `;
    }
  });
  console.log(`Baselined ${toStamp.length} migration(s) as already applied (no SQL was run).`);
  console.log("Only NEW migration files will execute from now on.");
}

// Verify the live schema contains the objects recent migrations should have
// created (see DOCTOR_MARKERS). Read-only. Run BEFORE `baseline` on an existing
// box: baseline stamps files as applied without proof, so a box that silently
// missed a hand-applied migration would otherwise have the gap hidden forever.
// Also the fastest way to answer "is this box's 500 error a missing column?".
async function cmdDoctor(sql: Sql): Promise<void> {
  const cols = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
  `;
  const have = new Set(cols.map((r) => `${r.table_name}.${r.column_name}`));
  const tables = new Set(cols.map((r) => r.table_name));

  const idxRows = await sql<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
  `;
  const indexes = new Set(idxRows.map((r) => r.indexname));

  let failures = 0;
  console.log("");
  for (const m of DOCTOR_MARKERS) {
    let target: string;
    let exists: boolean;
    if (m.index) {
      target = `${m.table} index ${m.index}`;
      exists = indexes.has(m.index);
    } else {
      target = m.column ? `${m.table}.${m.column}` : m.table;
      exists = m.column ? have.has(`${m.table}.${m.column}`) : tables.has(m.table);
    }
    const ok = m.absent ? !exists : exists;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${m.migration}  →  ${target} ${m.absent ? "removed" : "present"}${ok ? "" : "   ⚠️  NOT SATISFIED"}`,
    );
  }
  if (failures > 0) {
    console.error(
      `\n✗ ${failures} marker(s) missing — this box's schema is BEHIND the migration files.` +
        `\n  Do NOT baseline yet: apply the missing migration file(s) first, re-run` +
        `\n  doctor until clean, then baseline.\n`,
    );
    process.exit(1);
  }
  console.log("\n✓ all schema markers satisfied — safe to baseline this database.\n");
}

async function runMigration(sql: Sql, f: MigrationFile): Promise<void> {
  if (f.transactional) {
    await sql.begin(async (tx) => {
      await tx.unsafe(f.sql);
      await tx`INSERT INTO _migrations (name, checksum) VALUES (${f.filename}, ${f.checksum})`;
    });
    return;
  }
  // CONCURRENTLY cannot run in a transaction — but a multi-statement string is
  // sent as ONE simple query, which Postgres wraps in an implicit transaction
  // anyway, so CONCURRENTLY would still fail. Enforce the rule: a CONCURRENTLY
  // file must contain exactly one statement (put each in its own migration file).
  const withoutComments = f.sql.replace(/--[^\n]*/g, "");
  if (withoutComments.replace(/;\s*$/, "").trim().includes(";")) {
    throw new Error(
      `${f.filename} uses CONCURRENTLY but contains multiple statements; ` +
        `split each statement into its own migration file.`,
    );
  }
  // Execute as-is, then record. (If the DDL half-fails here the file is NOT
  // recorded, so a re-run retries it.)
  await sql.unsafe(f.sql);
  await sql`INSERT INTO _migrations (name, checksum) VALUES (${f.filename}, ${f.checksum})`;
}

async function cmdUp(sql: Sql, allowDestructive: boolean): Promise<void> {
  const files = loadMigrationFiles();
  const applied = await appliedMap(sql);
  warnOnDrift(files, applied);

  // Un-baselined-existing-DB guard: the schema is already present but nothing is
  // recorded. This is an existing box that was never baselined — do NOT replay
  // history onto it, and do NOT let the deploy continue either: proceeding would
  // launch NEW code against the OLD schema (silent breakage). Exit 3 so the
  // deploy step fails BEFORE PM2 reloads. A genuinely fresh DB has no tables, so
  // this can't fire there.
  if (applied.size === 0 && (await hasExistingSchema(sql))) {
    console.error(
      "\n✋ This database already has a schema but no migrations are recorded —\n" +
        "   it looks like an existing box that hasn't been baselined yet.\n" +
        "   Aborting so the deploy stops HERE, before the running app is touched.\n" +
        "   To fix (once per box):\n" +
        "     1. pnpm db:migrate:doctor    — verify recent schema markers exist\n" +
        "     2. pnpm db:migrate:baseline  — record current files as applied\n" +
        "     3. re-run the deploy\n" +
        "   (Or use the 'DB Migrate — Status / Doctor / Baseline' GitHub Action.)\n",
    );
    process.exit(3);
  }

  const pending = files.filter((f) => !applied.has(f.filename));
  if (pending.length === 0) {
    console.log("✓ database is up to date — nothing to apply.");
    return;
  }

  const blocked = pending.filter((f) => f.destructive);
  if (blocked.length > 0 && !allowDestructive) {
    console.error(
      `\n✋ ${blocked.length} pending migration(s) contain DROP/TRUNCATE:\n` +
        blocked.map((f) => `     • ${f.filename}`).join("\n") +
        `\n\n   Refusing to run them automatically. If this data loss is intended,` +
        `\n   re-run with --allow-destructive (or ALLOW_DESTRUCTIVE=true).\n`,
    );
    process.exit(1);
  }

  console.log(`Applying ${pending.length} migration(s)...`);
  for (const f of pending) {
    process.stdout.write(`  → ${f.filename} ... `);
    await runMigration(sql, f);
    console.log("done");
  }
  console.log(`✓ applied ${pending.length} migration(s).`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = (args.find((a) => !a.startsWith("-")) ?? "up") as Cmd;
  const allowDestructive =
    args.includes("--allow-destructive") || process.env.ALLOW_DESTRUCTIVE === "true";

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set — cannot connect to the database.");
    process.exit(1);
  }

  const sql = postgres(connectionString, {
    max: 1,
    onnotice: (notice) => {
      if (!EXPECTED_NOTICE_CODES.has(notice.code ?? "")) console.log(`  notice: ${notice.message}`);
    },
  });

  try {
    // Show which database we're about to touch (credentials stripped) so a wrong
    // DATABASE_URL is caught by eye before anything runs — vital with dev and
    // prod sharing one box.
    try {
      const u = new URL(connectionString);
      console.log(`Target DB: ${u.host}${u.pathname}  ·  command: ${cmd}`);
    } catch {
      /* non-URL connection string (e.g. key=value form) — skip the banner */
    }
    await ensureTable(sql);
    switch (cmd) {
      case "status":
        await cmdStatus(sql);
        break;
      case "baseline":
        await cmdBaseline(sql);
        break;
      case "doctor":
        await cmdDoctor(sql);
        break;
      case "up":
        await cmdUp(sql, allowDestructive);
        break;
      default:
        console.error(`Unknown command "${cmd}". Use: up | status | baseline | doctor`);
        process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\nMigration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
