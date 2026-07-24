// PM2 process definition for the SmartPlan Advisor API — DEV environment.
//
// Identical to ecosystem.config.cjs except the process name, so the dev API can
// run side-by-side with prod on the same box. Deployed to C:\smartplan-advisor-dev
// and fronted by IIS site "advisedev" (advisedev.smartplan.software) which
// reverse-proxies /api + /files to this process on localhost:5053 (API_PORT in
// C:\smartplan-advisor-dev\.env).
//
// Usage on the box (from C:\smartplan-advisor-dev):
//   pm2 startOrReload ecosystem.dev.config.cjs --update-env
//
// See ecosystem.config.cjs for the full rationale (tsx interpreter, Node >= 20.6).
const path = require("path");

module.exports = {
  apps: [
    {
      name: "smartplan-advisor-dev",
      cwd: path.join(__dirname, "apps", "api"),
      script: "src/index.ts",
      interpreter: "node",
      node_args: "--import tsx",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      time: true,
    },
  ],
};
