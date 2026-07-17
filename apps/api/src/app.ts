import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { createAuth, type Auth } from "./auth/auth.js";
import { domainUserIdFor, viewerFor } from "./auth/session.js";
import type { Viewer } from "./auth/access.js";
import type { Fetch } from "./auth/discordIdentity.js";
import { createShareRoutes } from "./og/shareRoutes.js";
import { createUploadRoutes } from "./uploads/uploadRoutes.js";
import { createIconRoutes } from "./icons/iconRoutes.js";
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

    /**
     * Browser-navigable sign-in.
     *
     * better-auth's own `sign-in/social` is POST-only and answers with a URL
     * for a client to redirect to — which is fine for a fetch-based login
     * button, but means there's nothing you can simply *link to* or paste in an
     * address bar. This is that link: it performs the POST server-side and
     * follows the redirect itself.
     *
     * `?next=` chooses where the user lands afterwards.
     */
    app.get("/api/login", async (c) => {
      // Resolve against the *SPA's* origin, not the API's. They're the same in
      // production, but in development the API has no `/` to land on — sending
      // people there is a 404 immediately after a successful login.
      const next = new URL(
        c.req.query("next") ?? "/",
        config.webOrigin,
      ).toString();
      const { headers, response } = await auth.api.signInSocial({
        body: { provider: "discord", callbackURL: next },
        returnHeaders: true,
      });
      if (!response?.url) {
        return c.json({ error: "Discord sign-in is unavailable." }, 500);
      }
      const redirect = c.redirect(response.url, 302);
      // Carry over anything better-auth set (OAuth state, PKCE) or the
      // callback will reject the round-trip.
      for (const [key, value] of headers.entries()) {
        if (key.toLowerCase() === "set-cookie") {
          redirect.headers.append("set-cookie", value);
        }
      }
      return redirect;
    });

    /** Browser-navigable sign-out, for the same reason. */
    app.get("/api/logout", async (c) => {
      const { headers } = await auth.api.signOut({
        headers: c.req.raw.headers,
        returnHeaders: true,
      });
      const next = new URL(
        c.req.query("next") ?? "/",
        config.webOrigin,
      ).toString();
      const redirect = c.redirect(next, 302);
      for (const [key, value] of headers.entries()) {
        if (key.toLowerCase() === "set-cookie") {
          redirect.headers.append("set-cookie", value);
        }
      }
      return redirect;
    });
  }

  const resolveUserId =
    getUserId ??
    (async (req: Request) => {
      if (!auth) return null;
      const session = await auth.api.getSession({ headers: req.headers });
      if (!session) return null;
      // NOT session.user.id: better-auth generates that, while our domain rows
      // are keyed by the Discord snowflake. See `domainUserIdFor`.
      return domainUserIdFor(db, session.user.id);
    });

  // Public share links: server-rendered so Discord's crawler gets real Open
  // Graph meta (plan §4.6/§4.7). Caddy proxies /p/* here in production.
  app.route(
    "/",
    createShareRoutes({ db, config, getUserId: resolveUserId, viewerFor }),
  );

  // Custom background uploads (plan §4.8).
  app.route("/", createUploadRoutes({ db, config, getUserId: resolveUserId }));

  // WoW icon catalog: sync trigger/status, palette search feed, and serving
  // (plan §11.1 / §4.9). Caddy proxies /api/* and /icons/* here in production.
  app.route(
    "/",
    createIconRoutes({ db, config, getUserId: resolveUserId, viewerFor }),
  );

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
