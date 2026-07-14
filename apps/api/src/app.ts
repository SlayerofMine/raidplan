import { Hono } from "hono";

/**
 * Build the RaidPlans Hono application.
 *
 * A factory (rather than a module-level singleton) so tests can spin up an
 * isolated instance and drive it via `app.request(...)` without binding a port
 * — see {@link ./server.ts} for the process/port entry point. Route groups
 * (tRPC, public share routes, uploads) are mounted here as later phases add
 * them; Phase 0 ships only the liveness probe.
 */
export function createApp() {
  const app = new Hono();

  // Liveness probe (plan §14 Observability). Cheap, unauthenticated, used by
  // the external uptime check and by `systemctl`/Caddy health wiring.
  app.get("/healthz", (c) =>
    c.json({ status: "ok", uptime: process.uptime() }),
  );

  return app;
}

/** Shared application instance for the running server. */
export const app = createApp();

export type App = ReturnType<typeof createApp>;
