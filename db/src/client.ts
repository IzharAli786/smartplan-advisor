import "./loadenv.js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
}

/** Shared postgres-js connection. `max` kept modest — this is an internal tool. */
export const sql = postgres(connectionString, { max: 10 });
export const db = drizzle(sql, { schema });
export { schema };
export type DB = typeof db;
