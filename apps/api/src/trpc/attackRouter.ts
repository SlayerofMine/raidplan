import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AnimSchema,
  AttackBindingsSchema,
  AttackParamSchema,
  PlanObjectSchema,
  StepOverrideSchema,
} from "@raidplan/shared";
import {
  createAttack,
  deleteAttack,
  getAttack,
  getAttackDefsByIds,
  listAttacksForEncounter,
  updateAttack,
} from "../attacks/attacksRepo.js";
import { adminProcedure, protectedProcedure, router } from "./context.js";

/**
 * Attack definitions (plan §17). Reads are open to any signed-in caller (the
 * viewer and WebM export fetch the defs a plan references); authoring — the
 * designer's create/update/delete — is gated to site admins via
 * {@link adminProcedure}, like encounters.
 */
const attackContent = {
  name: z.string().min(1).max(120),
  defaultSize: z
    .object({
      w: z.number().finite().positive(),
      h: z.number().finite().positive(),
    })
    .default({ w: 400, h: 400 }),
  objects: z.array(PlanObjectSchema),
  overrides: z.record(z.string().min(1), StepOverrideSchema).default({}),
  animations: z.array(AnimSchema),
  anchor: z
    .object({
      originId: z.string().min(1),
      facingId: z.string().min(1).optional(),
    })
    .optional(),
  params: z.array(AttackParamSchema).default([]),
  bindings: AttackBindingsSchema,
};

export const attackRouter = router({
  /** The definitions for a set of attack ids (what a plan's instances point at). */
  byIds: protectedProcedure
    .input(z.object({ ids: z.array(z.string().min(1)).max(200) }))
    .query(({ ctx, input }) =>
      Object.values(getAttackDefsByIds(ctx.db, input.ids)),
    ),

  /** Every attack authored for an encounter (for the palette and admin list). */
  listForEncounter: protectedProcedure
    .input(z.object({ encounterId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      listAttacksForEncounter(ctx.db, input.encounterId),
    ),

  /** One attack, for the designer to open. Admin-only — it's an authoring read. */
  get: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => {
      const def = getAttack(ctx.db, input.id);
      if (!def) throw new TRPCError({ code: "NOT_FOUND" });
      return def;
    }),

  create: adminProcedure
    .input(z.object({ encounterId: z.string().min(1), ...attackContent }))
    .mutation(({ ctx, input }) => createAttack(ctx.db, input)),

  update: adminProcedure
    .input(z.object({ id: z.string().min(1), ...attackContent }))
    .mutation(({ ctx, input }) => {
      const { id, ...content } = input;
      const updated = updateAttack(ctx.db, id, content);
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such attack." });
      }
      return updated;
    }),

  remove: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      if (!deleteAttack(ctx.db, input.id)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such attack." });
      }
      return { ok: true as const };
    }),
});
