import { closePool } from "@smart-crm/db";
import { buildApp } from "./app.js";
import { env } from "./env.js";
import { signalReady, registerShutdownHandlers, onShutdown } from "./lifecycle.js";
import { smartplanConfigured } from "./services/smartplan.js";

const INSTANCE = process.env.NODE_APP_INSTANCE ?? "0";

const app = await buildApp();

// Close the DB pool as the last step of a graceful shutdown, after Fastify has
// stopped serving and in-flight requests have drained.
onShutdown(closePool);

// Handlers are wired BEFORE listen resolves: a worker can be told to shut down
// while it is still binding, and an unhandled 'shutdown' message there means
// PM2 falls through to a hard kill.
registerShutdownHandlers(app);

app
  .listen({ port: env.port, host: "0.0.0.0" })
  .then(() => {
    console.log(`SmartPlan CRM API listening on http://localhost:${env.port} (instance ${INSTANCE})`);

    // Per-worker config visibility. env.ts snapshots process.env at MODULE LOAD,
    // so each worker captures whatever env it started with — a `pm2 reload`
    // after an .env edit, or any restart without --update-env, can leave worker
    // 0 configured and worker 1 not. An unconfigured worker drops its outbound
    // SmartPlan calls while its INBOUND routes keep working, so the app looks
    // healthy from every angle. This line is the only signal that it isn't.
    // Both workers must print true. Mirrors SmartPlan's logAdviseConfig().
    console.log(`[advise:${INSTANCE}] smartplan link configured: ${smartplanConfigured()}`);

    // Tell PM2 the port is actually bound. Until this fires, `wait_ready` keeps
    // the OLD worker alive — this is what makes `pm2 reload` zero-downtime
    // rather than a gap between spawn and bind. No-op outside PM2.
    signalReady();
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
