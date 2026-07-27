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
// CLUSTERED — AND WHY SETTING IT true IS NOT THE SAME AS BEING CLUSTERED
// ----------------------------------------------------------------------
// This was false while portal.smartplan.software was still a single fork-mode
// process: clustering the two halves of a pair independently buys nothing and
// doubles what can be wrong in the one window that matters. It is now true
// because portal was cut over with it — both on 2026-07-27, portal first.
//
// Flipping this constant is INERT ON ITS OWN. Deploys run deploy\pm2-roll.ps1,
// which for an already-running app issues `pm2 restart`, and restart reuses
// PM2's IN-MEMORY copy of the config. Code changes land; exec_mode, instances
// and the env: block below do not. So a deploy carrying this change leaves the
// box exactly as it was — which is the point: the ordering below is enforced by
// the runbook, not by this file, and shipping the flag early cannot surprise
// anyone.
//
// THE ORDER IS NOT OPTIONAL, and the reason is wait_ready:
//   1. Deploy this build to prod first, so the box is running app code that
//      actually calls process.send('ready') (apps/api/src/lifecycle.ts).
//   2. THEN, on the box, once:  pm2 delete smartplan-advisor
//                               pm2 start ecosystem.config.cjs
//                               pm2 save
//      exec_mode cannot change in place. ~10s of downtime, once, ever.
//   3. Verify:  pm2 describe smartplan-advisor   ->  mode: cluster, 2 instances
//      and that BOTH workers log "smartplan link configured: true".
//
// ALL THREE STEPS WERE DONE ON PROD 2026-07-27 (8s of downtime; pm_ids 13 and
// 14; both workers logged `[advise:N] smartplan link configured: true` and
// `[lifecycle:N] ready signal sent to PM2`; stderr empty on both). Kept as the
// recipe, because step 2 must be re-run by hand after ANY edit to exec_mode,
// instances or the env: block below — a deploy alone will not apply them.
//
// Starting a CLUSTER of a build that never emits ready means PM2 waits
// listen_timeout for a signal that is never coming, on every worker. Do step 1
// first. To revert, set this back to false and repeat step 2 — that returns the
// app to a single process while KEEPING the drain and the capped pool.
//
// DB_POOL_MAX below is already sized for 2 instances, so the connection
// footprint does not change when you flip it.
const path = require("path");
const { pathToFileURL } = require("url");

const APP_NAME = "smartplan-advisor";
const CLUSTERED = true;
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

      // merge_logs is deliberately NOT set, unlike SmartPlan's portal config
      // (whose single out.log had already reached 406 MB, so splitting it per
      // worker would have made a bad situation worse). Here the files are small
      // and one per worker is easier to read.
      //
      // The consequence, which has already cost one debugging session: in
      // cluster mode PM2 writes ~/.pm2/logs/smartplan-advisor-out-<pm_id>.log,
      // NOT ...-out.log. The unsuffixed file is a fork-mode leftover that
      // nothing writes to any more, so opening it and finding nothing means the
      // file is dead, not that the app is quiet. `pm2 logs` tails all of them.
    },
  ],
};
