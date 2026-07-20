import { z } from "zod";
import {
  getAttackDefsByIds,
  listAttacksForEncounter,
} from "../attacks/attacksRepo.js";
import { protectedProcedure, router } from "./context.js";

/**
 * Attack definitions (plan §17, stage 3). Read-only here — the client fetches
 * the defs a plan references so the viewer and WebM export can expand it. Admin
 * authoring (create/update/delete) arrives with the designer in stage 4.
 */
export const attackRouter = router({
  /** The definitions for a set of attack ids (what a plan's instances point at). */
  byIds: protectedProcedure
    .input(z.object({ ids: z.array(z.string().min(1)).max(200) }))
    .query(({ ctx, input }) =>
      Object.values(getAttackDefsByIds(ctx.db, input.ids)),
    ),

  /** Every attack authored for an encounter (for the palette). */
  listForEncounter: protectedProcedure
    .input(z.object({ encounterId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      listAttacksForEncounter(ctx.db, input.encounterId),
    ),
});
