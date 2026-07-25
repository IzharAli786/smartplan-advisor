// PM2 process definition for the SmartPlan Advisor API — DEV environment.
//
// Deployed to C:\smartplan-advisor-dev and fronted by IIS site "advisedev"
// (advisedev.smartplan.software), which reverse-proxies /api + /files to this
// process on localhost:5053 (API_PORT in C:\smartplan-advisor-dev\.env).
//
// Usage on the box (from C:\smartplan-advisor-dev):
//   pm2 startOrReload ecosystem.dev.config.cjs --update-env
//
// See ecosystem.config.cjs for the tsx-interpreter rationale (Node >= 20.6) and
// for why the two files differ in exec_mode.
//
// CLUSTER MODE — DEV LEADS
// ------------------------
// This app is paired with dev.smartplan.software, which runs PM2 cluster mode.
// Dev goes first on purpose: clustering is only meaningfully tested by a real
// deploy, and a 1-instance "cluster" proves nothing. Prod (advise) keeps
// exec_mode: fork until portal.smartplan.software is cut over with it.
//
// Running TypeScript source in cluster mode works, but ONLY with the absolute
// tsx loader path below. This was established by running the real app, not by
// reasoning about it.
const path = require("path");
const { pathToFileURL } = require("url");

const APP_NAME = "smartplan-advisor-dev";
const INSTANCES = 2;

const API_DIR = path.join(__dirname, "apps", "api");

// THE ONE THING THAT MAKES CLUSTER MODE WORK. Do not shorten this back to
// `node_args: "--import tsx"` — that is correct in fork mode and fatal here.
//
// Fork mode spawns a fresh `node` with cwd=apps/api, so the bare specifier
// "tsx" resolves against apps/api/node_modules, where pnpm keeps it (it is a
// devDependency of @smart-crm/api and is NOT hoisted to the workspace root).
// Cluster mode applies node_args to the PM2 daemon's fork of ProcessContainer
// instead, which resolves them from the REPO ROOT — where tsx does not exist.
// The result is an immediate, repeating:
//
//   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx'
//     imported from <repo root>/
//
// and PM2 gives up after 10 restarts with an "errored" process and, because the
// failure happens before the app can open its own log, EMPTY app log files. The
// only trace is ~/.pm2/pm2.log.
//
// Resolving from API_DIR and passing the absolute path sidesteps the whole
// question. pathToFileURL is required, not cosmetic: on the Windows box this
// path is C:\smartplan-advisor-dev\... and a bare backslash path passed to
// `--import` is not a valid module specifier.
const TSX_LOADER = pathToFileURL(require.resolve("tsx", { paths: [API_DIR] })).href;

module.exports = {
  apps: [
    {
      name: APP_NAME,
      cwd: API_DIR,
      script: "src/index.ts",
      interpreter: "node",
      // Array form, not a string: PM2 splits a string node_args on spaces, and
      // on Windows this path contains none today but is not guaranteed to.
      node_args: ["--import", TSX_LOADER],

      // exec_mode CANNOT be changed in place. The first switch from fork needs
      // a one-time `pm2 delete smartplan-advisor-dev` followed by
      // `pm2 start ecosystem.dev.config.cjs`; `startOrReload` alone will keep
      // running the existing fork process and silently ignore this line.
      exec_mode: "cluster",
      instances: INSTANCES,

      // PM2 waits for the new worker's process.send('ready') — sent from
      // apps/api/src/lifecycle.ts once Fastify has actually bound the port —
      // before retiring the worker it replaces. Without this PM2 kills the old
      // worker as soon as the new PROCESS exists, seconds before it can serve,
      // and every request in that gap is refused. This is the whole mechanism.
      wait_ready: true,
      listen_timeout: 30000,

      // Must exceed lifecycle.ts's DRAIN_BUDGET_MS (25s) so PM2 never hard-kills
      // a worker in the middle of its own orderly shutdown.
      kill_timeout: 30000,

      // Windows has no real SIGTERM: PM2 stops a process there by sending the
      // STRING 'shutdown' over IPC, which lifecycle.ts handles.
      //
      // READ THIS BEFORE TRUSTING IT — it does NOT cover `pm2 reload`.
      // Verified against pm2 6.0.14 source and observed in the logs:
      //   - `pm2 stop|restart|delete`  -> God.killProcess() sees a numeric
      //     pm_id, honours this flag, sends 'shutdown' over IPC. Drain runs.
      //   - `pm2 reload`               -> hardReload() first reassigns
      //     pm2_env.pm_id to the STRING '_old_<id>'. killProcess() gates the
      //     message path on `typeof pm_id === 'number'`, so that test fails and
      //     it falls through to process.kill(pid, SIGINT) — this flag is
      //     silently ignored. On Linux/macOS SIGINT still reaches our handler.
      //     On WINDOWS process.kill() is an unconditional TerminateProcess, so
      //     the retiring worker dies with NO drain at all.
      //
      // Consequence for the Windows box: `pm2 reload` is still zero-downtime
      // (the replacement is already `ready` before the old worker is touched),
      // but requests in flight on the retiring worker are reset rather than
      // drained. Deploys therefore use a ROLLING `pm2 restart <pm_id>` per
      // worker instead — that path keeps pm_id numeric, so the drain runs, and
      // it measured zero-downtime too because the sibling worker serves
      // throughout. See deploy/ZERO-DOWNTIME.md in the SmartPlan repo.
      shutdown_with_message: true,

      env: {
        NODE_ENV: "production",
        // Surfaces as application_name in pg_stat_activity — see db/src/client.ts.
        PM2_APP_NAME: APP_NAME,
        // PER WORKER. Real cost is DB_POOL_MAX * instances = 10, exactly what
        // this app used as a single fork process. Keep the product at 10:
        // Postgres max_connections is 100, shared with four other Node apps.
        DB_POOL_MAX: "5",
      },
      autorestart: true,
      max_restarts: 10,
      time: true,
    },
  ],
};
