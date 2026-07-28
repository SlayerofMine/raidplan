import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AttackBindingsSchema,
  AttackParamSchema,
  AttackScopeSchema,
  FollowSchema,
  PlanObjectSchema,
  SlideSchema,
  type AttackDef,
  type AttackScope,
} from "@raidplan/shared";
import type { Viewer } from "../auth/access.js";
import type { Db } from "../db/client.js";
import {
  createAttack,
  deleteAttack,
  getAttack,
  getAttackDefsByIds,
  listAttacksForEncounter,
  listAttacksForPlan,
  rescopeAttack,
  updateAttack,
} from "../attacks/attacksRepo.js";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./context.js";
import { mayView, requireEditable, requireViewable } from "./planAccess.js";

/**
 * Attack definitions (plan §17, re-gated in §19.1).
 *
 * The gate is on the **noun, not the verb**. Authoring an attack is not a
 * privilege; publishing one into an encounter's curated library is, because
 * that library is seen by every planner working that fight. So each procedure
 * asks what the def's {@link AttackScope} is and defers to a decision that
 * already exists — the admin allowlist for an encounter, `planAccess` for a
 * plan — rather than inventing a third notion of ownership.
 *
 *     encounter │ read: anyone, even anonymous │ write: site admin
 *     plan      │ read: canView(plan)          │ write: canEdit(plan)
 *
 * **Reads are public** because a definition is drawing, not a secret, and the
 * thing worth protecting is the plan that uses it — which `canView` already
 * protects. Keeping `byIds` behind a session while `plan.get` was public meant
 * a logged-out visitor following a share link watched the plan render with its
 * mechanics silently missing.
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
  /** The def's one slide — where its parts settle, and what takes them there. */
  slides: z.tuple([SlideSchema]),
  ox: z.number().finite().optional(),
  oy: z.number().finite().optional(),
  dir: z.number().finite().optional(),
  follow: FollowSchema.optional(),
  params: z.array(AttackParamSchema).default([]),
  bindings: AttackBindingsSchema,
};

/**
 * May this viewer *read* a definition in this scope?
 *
 * Used to filter, not to throw: `byIds` takes a list from the caller and must
 * drop what isn't theirs rather than fail the whole request, since a plan
 * legitimately mixes its own attacks with the encounter's.
 */
function mayRead(db: Db, scope: AttackScope, viewer: Viewer | null): boolean {
  return scope.kind === "encounter" || mayView(db, scope.planId, viewer);
}

/**
 * Assert this viewer may *author* in this scope, or throw.
 *
 * `requireEditable` answers for a plan, which also handles the plan not
 * existing (404, not 403 — see `planAccess`). An encounter takes the site-admin
 * allowlist, unchanged from §17.
 */
function assertMayAuthor(
  db: Db,
  scope: AttackScope,
  viewer: Viewer,
  isAdmin: boolean,
): void {
  if (scope.kind === "plan") {
    requireEditable(db, scope.planId, viewer);
    return;
  }
  if (!isAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only admins publish attacks to an encounter.",
    });
  }
}

/**
 * The def named by `id`, or `NOT_FOUND` — including when it exists but this
 * viewer may not see it, which must be indistinguishable from absent.
 */
function requireReadable(db: Db, id: string, viewer: Viewer | null): AttackDef {
  const def = getAttack(db, id);
  if (!def || !mayRead(db, def.scope, viewer)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such attack." });
  }
  return def;
}

export const attackRouter = router({
  /**
   * The definitions for a set of attack ids (what a plan's instances point at).
   *
   * Public, and **filtered by scope** rather than trusting the id list — the ids
   * are supplied by the caller, so this is the one place a stranger could ask
   * for someone else's plan-scoped attack by guessing. Unreadable ids are
   * dropped silently, exactly like ids that don't exist: a renderer's job is to
   * draw what it may see.
   */
  byIds: publicProcedure
    .input(z.object({ ids: z.array(z.string().min(1)).max(200) }))
    .query(({ ctx, input }) =>
      Object.values(getAttackDefsByIds(ctx.db, input.ids)).filter((def) =>
        mayRead(ctx.db, def.scope, ctx.viewer),
      ),
    ),

  /** An encounter's curated library — public, like the encounter itself. */
  listForEncounter: publicProcedure
    .input(z.object({ encounterId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      listAttacksForEncounter(ctx.db, input.encounterId),
    ),

  /** One plan's own attacks (§19.1), for anyone who may see that plan. */
  listForPlan: publicProcedure
    .input(z.object({ planId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      requireViewable(ctx.db, input.planId, ctx.viewer);
      return listAttacksForPlan(ctx.db, input.planId);
    }),

  /** One attack, for the designer to open — readable by whoever may read it. */
  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => requireReadable(ctx.db, input.id, ctx.viewer)),

  create: protectedProcedure
    .input(z.object({ scope: AttackScopeSchema, ...attackContent }))
    .mutation(({ ctx, input }) => {
      const { scope, ...content } = input;
      assertMayAuthor(ctx.db, scope, ctx.viewer, ctx.isAdmin ?? false);
      return createAttack(ctx.db, { scope, ...content });
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().min(1), ...attackContent }))
    .mutation(({ ctx, input }) => {
      const { id, ...content } = input;
      // The scope comes from the **stored def**, never from the caller. Taking
      // it from an argument would let anyone edit anyone's attack by naming a
      // plan they happen to own.
      const existing = requireReadable(ctx.db, id, ctx.viewer);
      assertMayAuthor(ctx.db, existing.scope, ctx.viewer, ctx.isAdmin ?? false);
      const updated = updateAttack(ctx.db, id, content);
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such attack." });
      }
      return updated;
    }),

  /**
   * Publish a plan's attack into an encounter's library (plan §19.3).
   *
   * Admin-only on both sides of the move, and deliberately so: this is the act
   * the §19.1 gate exists for. It is an `UPDATE` of the scope, so the id
   * survives and every instance already placed keeps working — it simply
   * becomes visible to everyone working that fight.
   */
  promote: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        encounterId: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      const existing = getAttack(ctx.db, input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such attack." });
      }
      if (existing.scope.kind === "encounter") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That attack is already in an encounter's library.",
        });
      }
      return rescopeAttack(ctx.db, input.id, {
        kind: "encounter",
        encounterId: input.encounterId,
      });
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const existing = requireReadable(ctx.db, input.id, ctx.viewer);
      assertMayAuthor(ctx.db, existing.scope, ctx.viewer, ctx.isAdmin ?? false);
      if (!deleteAttack(ctx.db, input.id)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such attack." });
      }
      return { ok: true as const };
    }),
});
