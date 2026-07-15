import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { createAuth, type Auth } from "./auth/auth.js";
import { viewerFor } from "./auth/session.js";
import type { Viewer } from "./auth/access.js";
import type { Fetch } from "./auth/discordIdentity.js";
import { appRouter } from "./trpc/appRouter.js";

export interface AppDeps {
  db: Db;
  config: Config;
  /**
   * Resolve the signed-in user id from a request, or null.
   *
   * Defaults to the better-auth session. Injected rather than imported so the
   * transport doesn't hard-depend on one auth provider (plan §10 keeps
   * Battle.net/email open), and so tests can drive the API as any user without
   * an OAuth round-trip.
   */
  getUserId?: (req: Request) => Promise<string | null> | string | null;
  /** Injected into the Discord provider for tests. */
  fetchImpl?: Fetch;
}

/**
 * Build the RaidPlans Hono application (plan §9): better-auth's routes, the
 * tRPC app API, and the plain public routes. Authorization itself lives in the
 * router; this only establishes *who* is calling.
 */
export function createApp({ db, config, getUserId, fetchImpl }: AppDeps) {
  const app = new Hono();

  // Auth is optional so the API still boots for local canvas work before
  // Discord credentials exist. `loadConfig` refuses this in production.
  const auth: Auth | null = config.authEnabled
    ? createAuth({ db, config, ...(fetchImpl ? { fetchImpl } : {}) })
    : null;

  app.get("/healthz", (c) =>
    c.json({
      status: "ok",
      uptime: process.uptime(),
      authEnabled: config.authEnabled,
    }),
  );

  // better-auth owns everything under /api/auth: the Discord redirect, the
  // callback, sign-out and session lookup. Caddy already proxies /api/* here,
  // which is why the callback URL registered with Discord resolves in prod.
  if (auth) {
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  }

  const resolveUserId =
    getUserId ??
    (async (req: Request) => {
      if (!auth) return null;
      const session = await auth.api.getSession({ headers: req.headers });
      return session?.user.id ?? null;
    });

  app.use(
    "/trpc/*",
    trpcServer({
      endpoint: "/trpc",
      router: appRouter,
      createContext: async (_opts, c) => {
        const userId = await resolveUserId(c.req.raw);
        const viewer: Viewer | null = userId ? viewerFor(db, userId) : null;
        return { db, viewer };
      },
    }),
  );

  return app;
}

export type App = ReturnType<typeof createApp>;
