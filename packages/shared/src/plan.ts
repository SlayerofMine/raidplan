import { z } from "zod";
import { PointSchema, TransformSchema } from "./transform.js";
import {
  AnimEffectSchema,
  AnimKindSchema,
  AnimTriggerSchema,
  ObjectTypeSchema,
  ShapeKindSchema,
} from "./effects.js";
import { ObjectStyleSchema } from "./mechanics.js";

/**
 * The Plan document (plan §5) — the single source of truth for a raid plan.
 * Validated by these zod schemas and persisted as one JSON blob
 * (`plan_data.doc`). Types are inferred from the schemas so the contract and
 * the TypeScript types can never drift apart.
 */

/** Current on-disk schema version. Bump when a migration is required. */
export const SCHEMA_VERSION = 1;

/** Opacity is always normalised to 0..1. */
const OpacitySchema = z.number().min(0).max(1);

/**
 * The base (step-independent) appearance of an object. This is its state
 * before any step overrides are applied — i.e. the settled state of step -1.
 */
export const ObjectBaseSchema = TransformSchema.extend({
  opacity: OpacitySchema,
  /** Class colour / custom tint, if any. */
  tint: z.string().optional(),
  /**
   * Editor-side identifier shown in the Animation panel and Timeline. Distinct
   * from `label`, which is the text drawn *on the canvas* — an object can be
   * named "Tank 1" for the author's benefit without printing that on the board.
   */
  name: z.string().optional(),
  label: z.string().optional(),
  /** Stacking order within the interactive layer. */
  z: z.number().finite(),
  visible: z.boolean(),
});
export type ObjectBase = z.infer<typeof ObjectBaseSchema>;

/** A single object placed on the board. */
export const PlanObjectSchema = z.object({
  id: z.string().min(1),
  type: ObjectTypeSchema,
  /** Reference into the icon manifest (plan §11), for icon-backed objects. */
  iconId: z.string().min(1).optional(),
  /** Which primitive to draw — only meaningful when `type` is `"shape"`. */
  shape: ShapeKindSchema.optional(),
  /**
   * Per-object visual customization for shapes/tethers (fill, outline, edge,
   * line). Optional — absent keeps the shape's built-in look. Distinct from
   * `base.tint`, which is colour; this is form.
   */
  style: ObjectStyleSchema.optional(),
  /**
   * Tether endpoints — the ids of the two objects a `type: "tether"` connects.
   * A tether's line is derived from these objects' resolved positions, so its
   * own transform is degenerate (see `mechanics.ts` `tetherOps`).
   */
  fromId: z.string().min(1).optional(),
  toId: z.string().min(1).optional(),
  base: ObjectBaseSchema,
  locked: z.boolean().optional(),
});
export type PlanObject = z.infer<typeof PlanObjectSchema>;

/** Tunable parameters for an animation, effect-dependent. */
export const AnimParamsSchema = z.object({
  toX: z.number().finite().optional(),
  toY: z.number().finite().optional(),
  toOpacity: OpacitySchema.optional(),
  /** Waypoints for `motion` effects (GSAP MotionPathPlugin). */
  path: z.array(PointSchema).optional(),
});
export type AnimParams = z.infer<typeof AnimParamsSchema>;

/** One animation attached to one object within a step. */
export const AnimSchema = z.object({
  id: z.string().min(1),
  objectId: z.string().min(1),
  kind: AnimKindSchema,
  effect: AnimEffectSchema,
  trigger: AnimTriggerSchema,
  delayMs: z.number().finite().nonnegative(),
  durationMs: z.number().finite().nonnegative(),
  /** GSAP ease name, e.g. "power2.out". */
  easing: z.string().min(1),
  params: AnimParamsSchema.optional(),
});
export type Anim = z.infer<typeof AnimSchema>;

/**
 * The end-state delta applied to a single object when a step is "settled".
 * Every field is optional: absent fields inherit the previous step's value
 * (see {@link ./resolve.ts}). This is the "PowerPoint slide" the author edits.
 */
export const StepOverrideSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite().nonnegative(),
    h: z.number().finite().nonnegative(),
    rotation: z.number().finite(),
    opacity: OpacitySchema,
    visible: z.boolean(),
  })
  .partial();
export type StepOverride = z.infer<typeof StepOverrideSchema>;

/** An ordered "slide": settled end-state deltas plus the animations to reach them. */
export const StepSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  overrides: z.record(z.string().min(1), StepOverrideSchema),
  animations: z.array(AnimSchema),
  /** Optional autoplay dwell before advancing to the next step. */
  autoAdvanceMs: z.number().finite().nonnegative().optional(),
});
export type Step = z.infer<typeof StepSchema>;

/** The background map the plan is drawn on, in native pixel dimensions. */
export const BackgroundSchema = z.object({
  assetId: z.string().min(1),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
export type Background = z.infer<typeof BackgroundSchema>;

/** The whole plan document. */
export const PlanSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  /** Encounter / map identifier. */
  raid: z.string(),
  background: BackgroundSchema,
  /** Base object set — objects exist across all steps. */
  objects: z.array(PlanObjectSchema),
  /** Ordered slides. */
  steps: z.array(StepSchema),
  schemaVersion: z.number().int().positive(),
});
export type Plan = z.infer<typeof PlanSchema>;

/**
 * Build an empty, valid plan. Useful for "new plan" flows and as a fixture.
 * Kept here (not in the store) so web and api agree on what "empty" means.
 */
export function makeEmptyPlan(params: {
  id: string;
  title?: string;
  raid?: string;
  background: Background;
}): Plan {
  return {
    id: params.id,
    title: params.title ?? "Untitled plan",
    raid: params.raid ?? "",
    background: params.background,
    objects: [],
    steps: [],
    schemaVersion: SCHEMA_VERSION,
  };
}
