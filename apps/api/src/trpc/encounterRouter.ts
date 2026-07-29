import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { AttackDefSchema, BackgroundSchema } from "@raidplan/shared";
import {
  createEncounter,
  deleteEncounter,
  listEncounters,
  publishEncounterAttack,
  unpublishEncounterAttack,
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

  /**
   * Ship an attack with this map (plan §21). Admin-only, because an encounter
   * is the one piece of content everyone's plans are seeded from.
   *
   * Reaches **new plans only**: a plan copies the library it was born with, so
   * publishing a fix cannot rewrite work someone has already saved.
   */
  publishAttack: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        attack: AttackDefSchema,
      }),
    )
    .mutation(({ ctx, input }) => {
      const updated = publishEncounterAttack(ctx.db, input.id, input.attack);
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such encounter.",
        });
      }
      return updated;
    }),

  unpublishAttack: adminProcedure
    .input(z.object({ id: z.string().min(1), attackId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const updated = unpublishEncounterAttack(
        ctx.db,
        input.id,
        input.attackId,
      );
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
