import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { viewerFor } from "./auth/session.js";
import type { Viewer } from "./auth/access.js";
import { appRouter } from "./trpc/appRouter.js";

export interface AppDeps {
  db: Db;
  config: Config;
  /**
   * Resolve the signed-in user id from a request, or null.
   *
   * Injected rather than imported so the transport doesn't hard-depend on a
   * particular auth provider (plan §10 keeps Battle.net/email open), and so
   * tests can drive the API as any user without a real OAuth round-trip.
   */
  getUserId?: (req: Request) => Promise<string | null> | string | null;
}

/**
 * Build the RaidPlans Hono application (plan §9): the tRPC app API plus the
 * plain public routes. Route groups are mounted here; the router itself owns
 * authorization.
 */
export function createApp({ db, config, getUserId }: AppDeps) {
  const app = new Hono();

  // Liveness probe (plan §14 Observability).
  app.get("/healthz", (c) =>
    c.json({
      status: "ok",
      uptime: process.uptime(),
      authEnabled: config.authEnabled,
    }),
  );

  app.use(
    "/trpc/*",
    trpcServer({
      endpoint: "/trpc",
      router: appRouter,
      createContext: async (_opts, c) => {
        const userId = getUserId ? await getUserId(c.req.raw) : null;
        const viewer: Viewer | null = userId ? viewerFor(db, userId) : null;
        return { db, viewer };
      },
    }),
  );

  return app;
}

export type App = ReturnType<typeof createApp>;
