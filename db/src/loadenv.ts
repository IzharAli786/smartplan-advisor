import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load the monorepo-root .env regardless of cwd. pnpm runs package scripts with cwd set
 * to the package dir, so a plain `dotenv/config` (cwd-based) misses the root .env.
 * We climb from this file's location until we find one.
 */
let dir = dirname(fileURLToPath(import.meta.url));
for (let i = 0; i < 7; i++) {
  const candidate = join(dir, ".env");
  if (existsSync(candidate)) {
    config({ path: candidate });
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}
