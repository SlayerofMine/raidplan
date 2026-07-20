import { listEncounters } from "../encounters/encountersRepo.js";
import { protectedProcedure, router } from "./context.js";

/**
 * Encounter presets (plan §17, stage 1). Read-only here — admin CRUD arrives in
 * stage 2 behind an `adminProcedure`. Gated to signed-in callers because the
 * only thing that consumes it, the new-plan selector, is itself signed-in.
 */
export const encounterRouter = router({
  list: protectedProcedure.query(({ ctx }) => listEncounters(ctx.db)),
});
