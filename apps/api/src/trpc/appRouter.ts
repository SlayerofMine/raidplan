import { protectedProcedure, router } from "./context.js";
import { attackRouter } from "./attackRouter.js";
import { encounterRouter } from "./encounterRouter.js";
import { planRouter } from "./planRouter.js";

/** The app API surface (plan §9). Consumed end-to-end typed by `apps/web`. */
export const appRouter = router({
  plan: planRouter,
  encounter: encounterRouter,
  attack: attackRouter,
  me: router({
    get: protectedProcedure.query(({ ctx }) => ({
      userId: ctx.viewer.userId,
      roles: ctx.viewer.roles,
      /** Drives the admin-panel link/route on the client (plan §17). */
      isAdmin: ctx.isAdmin ?? false,
    })),
  }),
});

export type AppRouter = typeof appRouter;
