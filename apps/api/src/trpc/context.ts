import { initTRPC, TRPCError } from "@trpc/server";
import type { Db } from "../db/client.js";
import type { Viewer } from "../auth/access.js";

/**
 * The request context. `viewer` is the authenticated caller (or `null`), which
 * is the **only** seam between authentication and the rest of the API: swapping
 * the auth provider means changing how a `Viewer` is derived, nothing else.
 */
export interface Context {
  db: Db;
  viewer: Viewer | null;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/** Open to anonymous callers — used by the public share endpoints. */
export const publicProcedure = t.procedure;

/** Requires a session; narrows `ctx.viewer` to non-null for the resolver. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.viewer) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first." });
  }
  return next({ ctx: { ...ctx, viewer: ctx.viewer } });
});
