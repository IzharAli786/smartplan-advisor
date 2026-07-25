import "./loadenv.js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
}

// Connection budget. The box runs Postgres with max_connections=100 (97 usable)
// shared by five Node apps plus SQL Server and IIS, so this number is not free.
//
// `max` is PER PROCESS. Under PM2 cluster mode the app runs N workers, so the
// real cost is DB_POOL_MAX * instances. The default of 5 with instances: 2 is
// deliberately chosen to reproduce exactly the 10 connections this app used as
// a single fork-mode process — clustering Advise must not enlarge its footprint.
// If you raise `instances` in the ecosystem config, lower this to match.
const POOL_MAX = Math.max(1, Number(process.env.DB_POOL_MAX) || 5);

// Which worker holds which connection, visible in pg_stat_activity. Without
// this every row just reads "postgres.js" and a leaking worker is unfindable.
const APP_NAME = process.env.PM2_APP_NAME || "advise";
const INSTANCE = process.env.NODE_APP_INSTANCE ?? "cli";

/** Shared postgres-js connection. Read POOL_MAX above before changing `max`. */
export const sql = postgres(connectionString, {
  max: POOL_MAX,
  // Hand idle connections back rather than holding all `max` open forever;
  // postgres-js keeps them indefinitely by default.
  idle_timeout: Math.max(1, Number(process.env.DB_IDLE_TIMEOUT_SEC) || 30),
  connection: {
    application_name: `${APP_NAME}:${INSTANCE}`.slice(0, 63),
  },
});

/**
 * Close the pool during a graceful shutdown. Registered as a lifecycle hook by
 * apps/api/src/index.ts; safe to call more than once.
 *
 * The timeout matters: postgres-js waits for in-flight queries, and without a
 * bound a single hung query would hold the drain open past PM2's kill_timeout,
 * turning an orderly reload into the hard taskkill this all exists to avoid.
 */
export async function closePool(): Promise<void> {
  await sql.end({ timeout: 5 });
}

export const db = drizzle(sql, { schema });
export { schema };
export type DB = typeof db;
