import "./loadenv.js";
import postgres from "postgres";

/** DANGER: drops the public schema and recreates it. Dev convenience only. */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to reset the database in production.");
  }
  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    console.log("✓ public schema reset. Run db:migrate then db:seed.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("reset failed:", err);
  process.exit(1);
});
