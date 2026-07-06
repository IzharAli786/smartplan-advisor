// PM2 process definition for the SmartPlan Advisor API.
//
// The Fastify API runs straight from TypeScript source via tsx — there is no
// compile step for the API (the only thing that gets built is the web PWA, by
// Vite, which IIS then serves). This mirrors how the app runs in dev
// (`tsx watch src/index.ts`) and sidesteps the workspace-package resolution
// problem: @smart-crm/db and @smart-crm/shared expose .ts source, which plain
// `node` cannot import but tsx can.
//
// Usage on the box (from C:\smartplan-advisor):
//   pm2 startOrReload ecosystem.config.cjs --update-env
//
// Requirements:
//   - Node >= 20.6      (for `node --import`)
//   - tsx installed     (via `pnpm install --prod=false`; it is a devDependency
//                        of @smart-crm/api and resolves from apps/api/node_modules)
//
// All runtime config (API_PORT, DATABASE_URL, AUTH_SECRET, WEB_ORIGIN, ...) is read
// from C:\smartplan-advisor\.env, which the app loads itself — see
// apps/api/src/loadenv.ts (it walks up from the source file to find the root .env).
const path = require("path");

module.exports = {
  apps: [
    {
      name: "smartplan-advisor",
      // cwd = apps/api so `--import tsx` resolves tsx from apps/api/node_modules.
      cwd: path.join(__dirname, "apps", "api"),
      script: "src/index.ts",
      interpreter: "node",
      node_args: "--import tsx",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      // Prefix pm2 logs with timestamps.
      time: true,
    },
  ],
};
