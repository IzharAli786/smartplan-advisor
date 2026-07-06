import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Load the monorepo-root .env regardless of cwd (pnpm runs scripts from the package dir). */
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
