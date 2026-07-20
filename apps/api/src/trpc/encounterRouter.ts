import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BackgroundSchema } from "@raidplan/shared";
import {
  createEncounter,
  deleteEncounter,
  listEncounters,
  updateEncounter,
} from "../encounters/encountersRepo.js";
import { adminProcedure, protectedProcedure, router } from "./context.js";

/**
 * Encounter presets (plan §17). `list` is open to any signed-in caller — the
 * new-plan selector consumes it — while authoring (`create`/`update`/`remove`)
 * is gated to site admins via {@link adminProcedure}. The panel edits an
 * encounter's name, raid and background; pre-placed content is authored later
 * and preserved across updates by the repo.
 */
export const encounterRouter = router({
  list: protectedProcedure.query(({ ctx }) => listEncounters(ctx.db)),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        raid: z.string().max(120).default(""),
        background: BackgroundSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      createEncounter(ctx.db, {
        name: input.name,
        raid: input.raid,
        background: input.background,
      }),
    ),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        raid: z.string().max(120).optional(),
        background: BackgroundSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      const updated = updateEncounter(ctx.db, id, patch);
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such encounter.",
        });
      }
      return updated;
    }),

  remove: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      if (!deleteEncounter(ctx.db, input.id)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such encounter.",
        });
      }
      return { ok: true as const };
    }),
});
