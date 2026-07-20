import { Hono, type Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";

/**
 * Discord-free sign-in for development and CI (plan §13), gated by `DEV_AUTH`.
 *
 * The problem it solves: every protected flow (create a plan, the admin panel)
 * needs a signed-in user, but Discord OAuth can't run in a Playwright browser or
 * a throwaway dev database. So when `config.devAuth` is on — which
 * {@link ../config.ts} refuses to allow in production — this mints a plain
 * session cookie naming a user id. `resolveUserId` in `app.ts` reads it exactly
 * where it would otherwise read a better-auth session, so the rest of the API is
 * none the wiser about *how* you signed in.
 *
 * Being an admin still comes from `ICON_ADMIN_USER_IDS`, not from here: dev-login
 * as an id on that allowlist to exercise admin-only routes.
 */
export const DEV_USER_COOKIE = "dev_user";

/** Read the dev-auth user id from a raw request's Cookie header, or null. */
export function readDevUserId(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== DEV_USER_COOKIE) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return value || null;
  }
  return null;
}

/**
 * Ensure a domain user row exists for a dev user — `plans.ownerId` and friends
 * are foreign keys, so signing in as a brand-new id must materialise the row.
 */
export function ensureDevUser(db: Db, id: string, name: string): void {
  db.insert(users)
    .values({ id, discordId: `dev:${id}`, name })
    .onConflictDoNothing()
    .run();
}

/** The `/api/dev/*` routes. Registered only when `config.devAuth` is on. */
export function createDevAuthRoutes({ db }: { db: Db }) {
  const app = new Hono();

  const signIn = (c: Context, id: string, name: string) => {
    ensureDevUser(db, id, name);
    setCookie(c, DEV_USER_COOKIE, id, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
  };

  // Browser-navigable, like /api/login: sets the cookie and lands you on `next`.
  app.get("/api/dev/login", (c) => {
    const id = c.req.query("userId");
    if (!id) return c.json({ error: "userId is required." }, 400);
    signIn(c, id, c.req.query("name") ?? id);
    return c.redirect(c.req.query("next") ?? "/", 302);
  });

  // Programmatic, for scripts and Playwright's request API.
  app.post("/api/dev/login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      userId?: string;
      name?: string;
    };
    const id = c.req.query("userId") ?? body.userId;
    if (!id) return c.json({ error: "userId is required." }, 400);
    signIn(c, id, c.req.query("name") ?? body.name ?? id);
    return c.json({ ok: true, userId: id });
  });

  app.get("/api/dev/logout", (c) => {
    deleteCookie(c, DEV_USER_COOKIE, { path: "/" });
    return c.redirect(c.req.query("next") ?? "/", 302);
  });

  return app;
}
