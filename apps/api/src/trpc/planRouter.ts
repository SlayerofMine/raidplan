import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  BackgroundSchema,
  PlanSchema,
  VisibilitySchema,
} from "@raidplan/shared";
import { canAdminister, canList, canView } from "../auth/access.js";
import {
  createPlan,
  duplicatePlan,
  findPlanRowBySlug,
  getPlanWithDoc,
  listPlansFor,
  PlanConflictError,
  renamePlan,
  saveDoc,
  setVisibility,
  softDeletePlan,
  toAcl,
} from "../plans/planRepo.js";
import { isValidSlug } from "../plans/slug.js";
import { getEncounter } from "../encounters/encountersRepo.js";
import { protectedProcedure, publicProcedure, router } from "./context.js";
import { requireEditable, requireViewable } from "./planAccess.js";

/**
 * The app API (plan §9). Every procedure resolves the plan, then asks
 * `auth/access.ts` whether this viewer may do this — the router is the only
 * place authorization is applied, and the repository stays unguarded and
 * honest about it.
 *
 * `requireViewable`/`requireEditable` live in `planAccess.ts` since §19.1, so
 * that a plan-scoped resource is gated by the very same decision as the plan.
 */

export const planRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200).optional(),
        guildId: z.string().min(1).nullable().optional(),
        /** Seed from an encounter preset (plan §17)… */
        encounterId: z.string().min(1).optional(),
        /** …or start on a bare map. Exactly one is required. */
        background: BackgroundSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const base = {
        ownerId: ctx.viewer.userId,
        guildId: input.guildId ?? null,
        ...(input.title !== undefined ? { title: input.title } : {}),
      };

      if (input.encounterId) {
        const encounter = getEncounter(ctx.db, input.encounterId);
        if (!encounter) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No such encounter.",
          });
        }
        return createPlan(ctx.db, {
          ...base,
          background: encounter.preset.background,
          objects: encounter.preset.objects,
          slides: encounter.preset.slides,
          raid: encounter.raid,
          // Remembered so a plan knows which encounter seeded it (§17).
          encounterId: encounter.id,
        });
      }

      if (!input.background) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pick an encounter or a starting map.",
        });
      }
      return createPlan(ctx.db, { ...base, background: input.background });
    }),

  list: protectedProcedure.query(({ ctx }) =>
    listPlansFor(ctx.db, {
      userId: ctx.viewer.userId,
      guildIds: Object.keys(ctx.viewer.roles),
    }).filter((plan) =>
      canList(
        {
          ownerId: plan.ownerId,
          guildId: plan.guildId,
          visibility: plan.visibility,
          deletedAt: null,
        },
        ctx.viewer,
      ),
    ),
  ),

  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => {
      requireViewable(ctx.db, input.id, ctx.viewer);
      const plan = getPlanWithDoc(ctx.db, input.id);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      return plan;
    }),

  /** Public share endpoint — no login for `unlisted`/`public` (plan §10). */
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(({ ctx, input }) => {
      if (!isValidSlug(input.slug)) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const row = findPlanRowBySlug(ctx.db, input.slug);
      if (!row || !canView(toAcl(row), ctx.viewer)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such plan." });
      }
      const plan = getPlanWithDoc(ctx.db, row.id);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      return plan;
    }),

  saveDoc: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        doc: PlanSchema,
        /** The version the client loaded; omit to force (plan §15). */
        expectedVersion: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      requireEditable(ctx.db, input.id, ctx.viewer);
      try {
        return saveDoc(ctx.db, {
          planId: input.id,
          doc: input.doc,
          ...(input.expectedVersion !== undefined
            ? { expectedVersion: input.expectedVersion }
            : {}),
        });
      } catch (error) {
        if (error instanceof PlanConflictError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This plan changed elsewhere. Reload before saving.",
            cause: error,
          });
        }
        throw error;
      }
    }),

  rename: protectedProcedure
    .input(
      z.object({ id: z.string().min(1), title: z.string().min(1).max(200) }),
    )
    .mutation(({ ctx, input }) => {
      requireEditable(ctx.db, input.id, ctx.viewer);
      renamePlan(ctx.db, input.id, input.title);
      return { ok: true as const };
    }),

  duplicate: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      // Duplicating only needs *read* access — copying a plan you can see into
      // your own account doesn't touch the original.
      requireViewable(ctx.db, input.id, ctx.viewer);
      const copy = duplicatePlan(ctx.db, {
        planId: input.id,
        ownerId: ctx.viewer.userId,
      });
      if (!copy) throw new TRPCError({ code: "NOT_FOUND" });
      return copy;
    }),

  setVisibility: protectedProcedure
    .input(z.object({ id: z.string().min(1), visibility: VisibilitySchema }))
    .mutation(({ ctx, input }) => {
      const row = requireViewable(ctx.db, input.id, ctx.viewer);
      // Re-sharing is an administrative act, not an edit.
      if (!canAdminister(toAcl(row), ctx.viewer)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner can change sharing.",
        });
      }
      setVisibility(ctx.db, input.id, input.visibility);
      return { ok: true as const };
    }),

  softDelete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const row = requireViewable(ctx.db, input.id, ctx.viewer);
      if (!canAdminister(toAcl(row), ctx.viewer)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner can delete this plan.",
        });
      }
      softDeletePlan(ctx.db, input.id);
      return { ok: true as const };
    }),
});
