// PM2 process definition for the SmartPlan Advisor API — PRODUCTION.
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
//
// WHY THIS IS STILL fork WHILE DEV IS cluster
// -------------------------------------------
// This app is paired with portal.smartplan.software, which is still a single
// fork-mode process. Clustering the two halves of a pair independently buys
// nothing and doubles the number of things that can be wrong during the one
// window where it matters, so prod flips WITH portal, not before it. Everything
// else in this change — the readiness signal, the graceful drain, the capped
// pool — is live here today and is worth having in fork mode on its own: before
// it, every deploy killed this process mid-request with no drain at all.
//
// TO FLIP TO CLUSTER (do it with the portal cutover, in a maintenance window):
//   1. Set CLUSTERED = true below and deploy.
//   2. On the box, once:  pm2 delete smartplan-advisor
//                         pm2 start ecosystem.config.cjs
//                         pm2 save
//      exec_mode cannot change in place — `startOrReload` will otherwise keep
//      running the existing fork process and silently ignore the setting.
//   3. Verify:  pm2 describe smartplan-advisor   ->  mode: cluster, 2 instances
//      and that BOTH workers log "smartplan link configured: true".
// DB_POOL_MAX below is already sized for 2 instances, so the connection
// footprint does not change when you flip it.
const path = require("path");
const { pathToFileURL } = require("url");

const APP_NAME = "smartplan-advisor";
const CLUSTERED = false;
const INSTANCES = CLUSTERED ? 2 : 1;

const API_DIR = path.join(__dirname, "apps", "api");

// Absolute tsx loader path. In FORK mode a bare `--import tsx` also works, since
// fork spawns node with cwd=apps/api where pnpm keeps tsx. In CLUSTER mode it
// does NOT: node_args are applied to the PM2 daemon's fork of ProcessContainer,
// which resolves them from the REPO ROOT, and tsx is a devDependency of
// @smart-crm/api that pnpm does not hoist there. The app then dies instantly and
// repeatedly with `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`, leaving
// EMPTY app log files — the only trace is ~/.pm2/pm2.log.
//
// Using the absolute path here means flipping CLUSTERED cannot reintroduce that.
// pathToFileURL is required, not cosmetic: this path is C:\smartplan-advisor\...
// on the box, and a bare backslash path is not a valid `--import` specifier.
const TSX_LOADER = pathToFileURL(require.resolve("tsx", { paths: [API_DIR] })).href;

module.exports = {
  apps: [
    {
      name: APP_NAME,
      cwd: API_DIR,
      script: "src/index.ts",
      interpreter: "node",
      // Array form, not a string: PM2 splits a string node_args on spaces.
      node_args: ["--import", TSX_LOADER],

      exec_mode: CLUSTERED ? "cluster" : "fork",
      instances: INSTANCES,

      // Useful in fork mode too: PM2 treats the app as started only once
      // apps/api/src/lifecycle.ts confirms Fastify has bound the port, instead
      // of the moment the process spawns. In cluster mode it becomes the thing
      // that makes `pm2 reload` genuinely zero-downtime.
      wait_ready: true,
      listen_timeout: 30000,

      // Must exceed lifecycle.ts's DRAIN_BUDGET_MS (25s) so PM2 never hard-kills
      // the process in the middle of its own orderly shutdown.
      kill_timeout: 30000,

      // Windows has no real SIGTERM: PM2 stops a process there by sending the
      // STRING 'shutdown' over IPC, which lifecycle.ts handles. In fork mode
      // this is what makes `pm2 restart` drain instead of hard-killing.
      //
      // It does NOT apply to `pm2 reload` in cluster mode — see the long note
      // in ecosystem.dev.config.cjs. Short version: reload reassigns pm_id to a
      // string, and PM2 gates the IPC path on pm_id being numeric, so it falls
      // back to a signal. Deploys use a rolling `pm2 restart <pm_id>` instead.
      shutdown_with_message: true,

      env: {
        NODE_ENV: "production",
        // Surfaces as application_name in pg_stat_activity — see db/src/client.ts.
        PM2_APP_NAME: APP_NAME,
        // PER WORKER. Sized so that DB_POOL_MAX * 2 instances = 10, matching
        // what this app used as a single fork process — so flipping CLUSTERED
        // does not enlarge the footprint. Postgres max_connections is 100,
        // shared with four other Node apps.
        DB_POOL_MAX: "5",
      },
      autorestart: true,
      max_restarts: 10,
      // Prefix pm2 logs with timestamps.
      time: true,
    },
  ],
};
