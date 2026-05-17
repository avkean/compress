import type { Server } from "node:http";

const SHUTDOWN_GRACE_MS = 10_000;

// Cleanly drain in-flight requests on SIGTERM/SIGINT so a redeploy or Ctrl-C
// doesn't 502 a user mid-upload. Also wires top-level error handlers so the
// process exits non-zero on unhandled errors instead of silently degrading.
export function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, draining (${SHUTDOWN_GRACE_MS}ms grace)…`);
    const timer = setTimeout(() => {
      console.warn("Drain timed out; forcing exit.");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    timer.unref();
    server.close((error) => {
      if (error) {
        console.error("server.close error:", error.message);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Crash loud and exit. A process manager (systemd, pm2, kubernetes) will
  // restart us with a clean slate, which is safer than continuing in an
  // unknown state.
  process.on("uncaughtException", (error) => {
    console.error("uncaughtException:", error?.stack ?? error);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("unhandledRejection:", reason instanceof Error ? reason.stack : reason);
    process.exit(1);
  });
}
