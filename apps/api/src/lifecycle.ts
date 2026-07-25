// Process lifecycle: readiness, draining, and graceful shutdown.
//
// This is the Advise-side counterpart of SmartPlan's server/lifecycle.ts. The
// two apps are deployed in pairs on the same Windows box and reload the same
// way, so they deliberately share this logic: same exported names, same env
// vars (SHUTDOWN_DRAIN_MS), same `[lifecycle:<instance>]` log prefix. If you
// change the contract here, change it there too.
//
//   dev.smartplan.software (:5050)    <-> advisedev.smartplan.software (:5053)
//   portal.smartplan.software (:5000) <-> advise.smartplan.software    (:5052)
//
// WHY THIS EXISTS
// ---------------
// Under PM2 cluster mode, `pm2 reload` replaces workers one at a time. That is
// only zero-downtime if two things are true:
//
//   1. A new worker announces itself when it is ACTUALLY LISTENING, not when
//      its process spawns. PM2 waits for that announcement (wait_ready) before
//      killing the worker it replaces. Without it PM2 kills the old worker as
//      soon as the new PROCESS exists — well before Fastify binds the port —
//      and every request in that gap is refused.
//
//   2. The worker being retired finishes what it is already doing instead of
//      vanishing mid-request. Before this module the API had NO signal handlers
//      and NO shutdown path at all: every deploy was a hard kill, mid-request.
//
// THE WINDOWS DETAIL THAT MATTERS MOST
// ------------------------------------
// Windows has no real SIGTERM/SIGINT. PM2 stops a process there by sending the
// STRING 'shutdown' over its IPC channel. If you only handle signals, the app
// looks fine, PM2 reports success, and every reload is silently a hard taskkill
// after kill_timeout expires. That is the single most likely way for this work
// to appear done while doing nothing, so both paths are handled below.

type ShutdownHook = () => void | Promise<void>;

/** Fastify's shape, structurally — avoids importing the type into a leaf module. */
type Closable = { close: () => Promise<unknown> };

const INSTANCE = process.env.NODE_APP_INSTANCE ?? "0";

// Must stay comfortably BELOW the ecosystem config's `kill_timeout` (30000), or
// PM2 hard-kills the process in the middle of its own orderly shutdown.
const DRAIN_BUDGET_MS = Number(process.env.SHUTDOWN_DRAIN_MS || 25_000);

let draining = false;
let shutdownStarted = false;

const hooks: ShutdownHook[] = [];
const inFlight = new Set<Promise<unknown>>();

function log(message: string): void {
  console.log(`[lifecycle:${INSTANCE}] ${message}`);
}

/**
 * True once the process has begun shutting down. Handlers can use this to stop
 * accepting new background work.
 */
export function isDraining(): boolean {
  return draining;
}

/** Register a cleanup callback (pool close, etc). Run in registration order. */
export function onShutdown(hook: ShutdownHook): void {
  hooks.push(hook);
}

/**
 * Track a detached background promise so the drain waits for it.
 *
 * NO CALLERS TODAY — every outbound SmartPlan call in services/smartplan.ts is
 * awaited inside its request handler, so `app.close()` already covers them.
 * This exists so that the first person to write `void pushSomething()` does not
 * reproduce SmartPlan's stripeWebhook bug, where a detached push died with the
 * worker and a commission was permanently lost. Use this instead of a bare
 * `void`. Errors are swallowed exactly as `void` swallowed them.
 */
export function trackWork<T>(work: Promise<T>): Promise<T> {
  const tracked = work.catch((err) => {
    console.error(`[lifecycle:${INSTANCE}] background work failed:`, err);
    return undefined as unknown as T;
  });
  inFlight.add(tracked);
  void tracked.finally(() => inFlight.delete(tracked));
  return work;
}

/**
 * Exit, but let the log pipe drain first.
 *
 * Under PM2 cluster mode stdout is an ASYNC PIPE to the master process, not a
 * file. `process.exit()` discards whatever is still buffered in it, so the last
 * lines written — including "drain complete" — silently never reach
 * `pm2 logs`. The drain still ran; you just cannot prove it did, which is
 * exactly the evidence the deploy runbook tells an operator to check.
 *
 * The empty writes queue behind everything already buffered, so their callbacks
 * fire once the pipe has drained. The timer is a hard bound: flushing must never
 * become the reason this process outlives PM2's kill_timeout.
 */
function exitAfterFlush(code: number): void {
  let pending = 2;
  const done = (): void => {
    process.exit(code);
  };
  const guard = setTimeout(done, 1000);
  if (typeof guard.unref === "function") guard.unref();
  const one = (): void => {
    if (--pending === 0) {
      clearTimeout(guard);
      done();
    }
  };
  process.stdout.write("", one);
  process.stderr.write("", one);
}

function settleWithin<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      onTimeout();
      resolve();
    }, ms);
    void promise.then(
      () => {
        clearTimeout(t);
        resolve();
      },
      () => {
        clearTimeout(t);
        resolve();
      },
    );
  });
}

/**
 * Announce readiness to PM2. No-op outside PM2 (process.send is undefined), so
 * `pnpm dev` and a bare `tsx src/index.ts` are unaffected.
 */
export function signalReady(): void {
  if (typeof process.send === "function") {
    process.send("ready");
    log("ready signal sent to PM2");
  }
}

/**
 * Stop serving, let in-flight work finish, run cleanup hooks, exit.
 *
 * Idempotent: PM2 on Windows can deliver the IPC 'shutdown' message and a
 * SIGINT, and a second trigger must not restart the sequence.
 */
async function shutdown(reason: string, app?: Closable): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  draining = true;
  const startedAt = Date.now();
  log(`draining (${reason})`);

  // 1. Stop accepting new connections and let in-flight requests finish.
  //
  //    Fastify 5 defaults `forceCloseConnections` to 'idle' on Node >=18, so
  //    close() already drops idle keep-alive sockets — without that, a browser
  //    holding an open connection keeps the server "in use" until kill_timeout.
  //    It will however wait indefinitely on a genuinely hung request, hence the
  //    hard budget around it.
  if (app) {
    await settleWithin(Promise.resolve(app.close()), Math.max(1000, DRAIN_BUDGET_MS - 5000), () =>
      log("fastify close timed out — abandoning remaining connections"),
    );
    log("fastify server closed");
  }

  // 2. Wait for tracked background work within what is left of the budget.
  const remaining = Math.max(0, DRAIN_BUDGET_MS - (Date.now() - startedAt));
  if (inFlight.size > 0 && remaining > 0) {
    log(`waiting up to ${remaining}ms for ${inFlight.size} background task(s)`);
    await settleWithin(Promise.all(Array.from(inFlight)), remaining, () =>
      log(`${inFlight.size} background task(s) did not finish in time — abandoning`),
    );
  }

  // 3. Cleanup hooks (the postgres-js pool). Never let one failing hook skip
  //    the rest.
  for (const hook of hooks) {
    try {
      await hook();
    } catch (err) {
      console.error(`[lifecycle:${INSTANCE}] shutdown hook failed:`, err);
    }
  }

  log(`drain complete in ${Date.now() - startedAt}ms — exiting`);
  exitAfterFlush(0);
}

/**
 * Wire every shutdown trigger this process can receive.
 *
 * Call once, after the server is listening.
 */
export function registerShutdownHandlers(app?: Closable): void {
  // POSIX path: local dev, and PM2 on Linux.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void shutdown(signal, app));
  }

  // WINDOWS PATH — the important one on this box. PM2 has no signals to send on
  // Windows, so it writes the string 'shutdown' to the IPC channel instead.
  //
  // Which of these two handlers actually fires tells you which PM2 code path
  // retired the worker, so the reason string is worth reading in `pm2 logs`:
  //   "pm2-shutdown-message" -> stop/restart/delete. Drains on every OS.
  //   "SIGINT"               -> `pm2 reload`. PM2 ignores shutdown_with_message
  //                             there (it reassigns pm_id to a string first and
  //                             gates the IPC path on pm_id being numeric).
  //                             Fine on POSIX; on Windows process.kill() is an
  //                             unconditional TerminateProcess, so this handler
  //                             never runs at all and the worker dies undrained.
  // Deploys therefore roll `pm2 restart <pm_id>` per worker rather than calling
  // `pm2 reload`. Both measured zero-downtime; only restart also drains.
  process.on("message", (msg) => {
    if (msg === "shutdown") void shutdown("pm2-shutdown-message", app);
  });

  // A crash in one worker must not leave a half-dead worker in PM2's rotation.
  process.on("uncaughtException", (err) => {
    console.error(`[lifecycle:${INSTANCE}] uncaught exception:`, err);
    void shutdown("uncaughtException", app);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(`[lifecycle:${INSTANCE}] unhandled rejection:`, reason);
  });
}
