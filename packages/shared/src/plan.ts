import { z } from "zod";
import { PointSchema, TransformSchema } from "./transform.js";
import { FollowSchema } from "./follow.js";
import {
  AnimEffectSchema,
  AnimKindSchema,
  AnimTriggerSchema,
  ObjectTypeSchema,
  ShapeKindSchema,
} from "./effects.js";
import { ObjectStyleSchema } from "./mechanics.js";
import {
  AttackInstanceSchema,
  AttackParamSchema,
  AttackSourceSchema,
  type AttackInstance,
} from "./attack.js";

/**
 * The Plan document (plan §5) — the single source of truth for a raid plan.
 * Validated by these zod schemas and persisted as one JSON blob
 * (`plan_data.doc`). Types are inferred from the schemas so the contract and
 * the TypeScript types can never drift apart.
 */

/**
 * Current on-disk schema version. Bump when a migration is required.
 *
 * **4** replaced the `base` + cascading sparse `steps` model with **slides**:
 * each slide carries a *complete* state for each object it contains, so editing
 * one slide can never change another. Documents written at 3 or below do not
 * parse.
 *
 * A slide's `states` doubles as its cast list — an object is on a slide iff it
 * has an entry — which is a change of *meaning* within 4, not of shape. Every
 * document written before it listed every object on every slide, which still
 * says exactly what it always did: they are all in every scene.
 *
 * **5** finished that job for attacks (plan §19.2), giving an attack definition
 * the same `slides: [Slide]` model as everything else. Plan documents were
 * unaffected in shape.
 *
 * **6** removed reusable attacks altogether (plan §17-§19). The `attacks` array
 * and the `placeholder` object type — a hole in a definition for the using plan
 * to fill — went with them. A document written at 5 still opens: {@link
 * PlanSchema} is not strict, so an `attacks` array left over from one is dropped
 * on the way in rather than rejected, and no migration step is needed. What that
 * plan loses is the attacks themselves, which no longer have anything to draw
 * them. The geometry attacks were built on — `follow`, origins and `dir`
 * (§18.17) — stays,
 * because it never needed them: pinning one object to another and aiming it at a
 * third is a property of objects, not of attacks.
 *
 * **7** brought attacks back on a different footing (plan §21): a plan carries
 * its own `attacks` — definitions, not references — a slide carries the
 * `attackInstances` placed on it, and an object may be a slot (`slotName`) or
 * belong to an instance (`attackId`). All four are optional or defaulted, so a
 * document written at 6 opens unchanged and needs no migration step; what it
 * gains is an empty attack library.
 */
export const SCHEMA_VERSION = 7;

/** Opacity is always normalised to 0..1. */
const OpacitySchema = z.number().min(0).max(1);

/**
 * An object's **slide-independent** properties, plus the transform it was
 * created with.
 *
 * Two different lifetimes live here, and the split matters:
 *
 *  - `z`, `tint`, `name`, `label`, `ox`, `oy`, `dir` are properties of the
 *    object itself. They are the same on every slide and are read live.
 *  - `x`, `y`, `w`, `h`, `rotation`, `opacity`, `visible` are the **creation
 *    seed** only. Since schema 4 every slide carries its own complete
 *    {@link SlideStateSchema}, so nothing renders from these — they are read
 *    when a new slide entry is minted, and are otherwise stale. Read the slide,
 *    never the seed.
 *
 * They stay on one schema because a new object needs somewhere to be born
 * before any slide has an opinion about it.
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
  /**
   * Objects sharing a `groupId` are selected and transformed as one (plan
   * §18.1). A group exists precisely when two or more objects share the id —
   * there's no separate record to keep in step, so deleting members can never
   * strand one.
   */
  groupId: z.string().min(1).optional(),
  /**
   * What this object follows (plan §18.17): its origin pinned to one object,
   * its direction aimed at another. Absent means it stays where it's put.
   *
   * "This cone starts at the boss and points at the tank" is a thing a planner
   * wants to say about a shape they drew, and this is where they say it.
   */
  follow: FollowSchema.optional(),
  /**
   * This object is a **slot**: a stand-in for something the using plan supplies
   * (plan §21). Only meaningful inside an {@link AttackDefSchema} — the same way
   * `shape` is only meaningful when `type` is `"shape"` — and the value is the
   * label the planner is asked for ("the tank"). Presence *is* the declaration,
   * so there is no separate list of slots to fall out of step with the objects.
   *
   * A slot is never stamped into a plan. Every reference to it — an animation's
   * `objectId` or `collideWith`, a tether's `fromId`/`toId`, a `follow` — is
   * rewritten to the plan object bound to it.
   */
  slotName: z.string().min(1).optional(),
  /**
   * Which attack instance stamped this object (plan §21). Set only on objects
   * the instance **owns**, never on a plan object merely bound to one of its
   * slots — so deleting an attack can never delete a planner's token.
   *
   * Like `groupId`, membership lives here rather than in a list on the instance,
   * so deleting an object can never strand a reference to it.
   */
  attackId: z.string().min(1).optional(),
});
export type PlanObject = z.infer<typeof PlanObjectSchema>;

/**
 * Tunable parameters for an animation, effect-dependent.
 *
 * **An animation says what it does, by itself.** Every effect starts from the
 * object's state on its own slide and reaches a target stated here — nothing is
 * read from a neighbouring slide, so a `move` means the same thing on slide 1 as
 * on slide 9, and editing one slide can never change what another one plays.
 */
export const AnimParamsSchema = z.object({
  /**
   * Where a `move` ends up, as the object's top-left in plan pixels — the same
   * coordinates as its {@link SlideStateSchema}. Absent means it goes nowhere.
   *
   * On an entrance `fly` this is read the other way round: the point it flies
   * *in from*. The name predates both and is kept because documents use it.
   */
  toX: z.number().finite().optional(),
  toY: z.number().finite().optional(),
  toOpacity: OpacitySchema.optional(),
  /**
   * What a `scale` grows or shrinks to, as a multiple of the object's size on
   * its slide — `1.5` is half again as big, `0.5` is half. About the centre, so
   * the object swells in place. Absent means no change.
   */
  scale: z.number().finite().positive().optional(),
  /**
   * **Interior** waypoints for a `move`, as absolute plan-pixel positions of the
   * object's *centre* — the corners of the route between where the object starts
   * and `toX`/`toY`.
   *
   * Interior only: the start is where the object is on this slide, which is a
   * thing you can see and drag, so storing a copy of it would only create
   * something to fall out of step with. The end is `toX`/`toY`, which belongs to
   * the animation because that is the whole point — a move is a complete
   * statement of a journey, not a difference between two slides.
   *
   * Centres rather than top-lefts because that is what a drawn route means; the
   * conversion to the document's top-left `x`/`y` happens at playback, using the
   * object's size at the start of the move (see `motionPath.ts`).
   */
  path: z.array(PointSchema).optional(),
  /**
   * How much the route rounds off at its waypoints: `0` (the default) is a
   * polyline with hard corners, `1` a smooth curve passing through every one.
   */
  curve: z.number().min(0).max(1).optional(),
});
export type AnimParams = z.infer<typeof AnimParamsSchema>;

/** One animation attached to one object within a slide. */
export const AnimSchema = z.object({
  id: z.string().min(1),
  objectId: z.string().min(1),
  kind: AnimKindSchema,
  effect: AnimEffectSchema,
  trigger: AnimTriggerSchema,
  /**
   * For `trigger: "onCollision"` — the ids of the objects that can set this
   * animation off by overlapping `objectId`. A **trigger condition**, which is
   * why it sits here rather than in `params` (effect-dependent tuning).
   * Empty/absent means nothing can trigger it.
   */
  collideWith: z.array(z.string().min(1)).optional(),
  delayMs: z.number().finite().nonnegative(),
  durationMs: z.number().finite().nonnegative(),
  /** GSAP ease name, e.g. "power2.out". */
  easing: z.string().min(1),
  params: AnimParamsSchema.optional(),
});
export type Anim = z.infer<typeof AnimSchema>;

/**
 * One object's **complete** visual state on one slide.
 *
 * Every field is required: an entry is whole or it is absent, never partial.
 * That is the whole point of the model — with nothing inherited from a previous
 * slide there is no cascade, so editing slide 2 cannot move anything on slide 3.
 * Structurally identical to {@link ./resolve.js ObjectState}, which is what the
 * renderers consume.
 */
export const SlideStateSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().nonnegative(),
  h: z.number().finite().nonnegative(),
  rotation: z.number().finite(),
  opacity: OpacitySchema,
  visible: z.boolean(),
});
export type SlideState = z.infer<typeof SlideStateSchema>;

/**
 * One slide: its own cast, in a complete layout, plus the animations that morph
 * the *previous* slide's layout into it.
 *
 * Slide 0 is the opening layout and has nothing before it, so it is static —
 * entrances and emphasis play, but a `move` has nowhere to move from (see
 * {@link ./resolve.js resolveSlideTransition}).
 */
export const SlideSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  /**
   * objectId → its complete state on this slide, for the objects **on** this
   * slide. This is the cast list as much as the layout: an object with no entry
   * here is not in this scene, and putting one on slide 3 leaves slides 1 and 2
   * alone. Ids refer into `plan.objects`, which says what each one *is*.
   */
  states: z.record(z.string().min(1), SlideStateSchema),
  animations: z.array(AnimSchema),
  /**
   * The attacks placed on this slide, by instance id (plan §21). Here rather
   * than on the plan because an attack lives on exactly one slide: its objects
   * are in this scene and its animations are in this list.
   *
   * A **recipe**, not a record of what was stamped — see
   * {@link AttackInstanceSchema}. The objects and animations it produced are
   * ordinary members of `states` and `animations` above, which is why nothing
   * that plays a slide has to know attacks exist.
   *
   * Optional, like `name` and `autoAdvanceMs`: a slide with no attacks on it has
   * nothing to say here, so every document written before §21 is already valid.
   * Read it through {@link slideAttacks}, never directly.
   */
  attackInstances: z.record(z.string().min(1), AttackInstanceSchema).optional(),
  /** Optional autoplay dwell before advancing to the next slide. */
  autoAdvanceMs: z.number().finite().nonnegative().optional(),
});
export type Slide = z.infer<typeof SlideSchema>;

/**
 * The attacks placed on a slide — `{}` when it has none.
 *
 * The one reader of `slide.attackInstances`, so "absent" and "empty" are the
 * same thing everywhere rather than at each call site's discretion.
 */
export function slideAttacks(slide: Slide): Record<string, AttackInstance> {
  return slide.attackInstances ?? {};
}

/**
 * An attack definition: objects, one slide, and the parameters it exposes
 * (plan §21).
 *
 * **One slide, by construction** — not `slides: [Slide]`. An attack is a thing
 * that happens, and a thing that happens has one scene; making the singular
 * shape the only representable one is cheaper than checking for it everywhere.
 *
 * Here rather than in `attack.ts` because a plan carries attacks and an attack
 * carries plan objects — mutually recursive, so one file has to hold both ends.
 */
export const AttackDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Where it came from, for the palette's badge. */
  source: AttackSourceSchema,
  objects: z.array(PlanObjectSchema),
  slide: SlideSchema,
  params: z.array(AttackParamSchema).default([]),
});
export type AttackDef = z.infer<typeof AttackDefSchema>;

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
  /**
   * The encounter this plan was seeded from (plan §17). Optional — plans that
   * started on a bare map have none.
   */
  encounterId: z.string().min(1).optional(),
  background: BackgroundSchema,
  /**
   * The **registry** of objects the slides draw from: what each one is (icon,
   * shape, tint, style, what it follows), under an id. Whether a given object
   * appears in a given scene, and where, is the slide's business — see
   * {@link SlideSchema}'s `states`.
   *
   * Plan-level rather than per-slide because identity is what makes a `move`
   * possible: the same id on two slides is what says "this token, then there".
   */
  objects: z.array(PlanObjectSchema),
  /**
   * Ordered slides — **always at least one**. A plan with no slides has no
   * layout to show, and the old "base layout, plus zero or more slides" split is
   * exactly the thing slides replaced.
   */
  slides: z.array(SlideSchema).min(1),
  /**
   * What each group is **called**, keyed by the `groupId` its members share
   * (plan §18.1). Names only: a group still *exists* precisely because two or
   * more objects share an id, so this record can never be the thing that says
   * whether one is there — losing it costs a name, not a group.
   *
   * Lock and visibility are deliberately **not** here. Both are fanned out onto
   * the members instead, because every part of the app that already honours
   * `object.locked` and a slide's `visible` would otherwise have to learn to
   * ask a second question, and the two answers could then disagree.
   */
  groups: z.record(z.string().min(1), z.string()).default({}),
  /**
   * The attacks this plan can place (plan §21) — **definitions, not
   * references**. Ones seeded from the plan's encounter were copied in when the
   * plan was created, so a plan is self-contained: it exports, imports and
   * duplicates whole, and an admin editing an encounter can never reach into
   * work someone has already saved.
   */
  attacks: z.array(AttackDefSchema).default([]),
  schemaVersion: z.number().int().positive(),
});
export type Plan = z.infer<typeof PlanSchema>;

/** The opening slide every plan starts with — an empty board, nothing animating. */
export function makeFirstSlide(): Slide {
  return { id: "slide-1", name: "Slide 1", states: {}, animations: [] };
}

/**
 * Build an empty, valid plan. Useful for "new plan" flows and as a fixture.
 * Kept here (not in the store) so web and api agree on what "empty" means.
 */
export function makeEmptyPlan(params: {
  id: string;
  title?: string;
  raid?: string;
  encounterId?: string;
  background: Background;
}): Plan {
  return {
    id: params.id,
    title: params.title ?? "Untitled plan",
    raid: params.raid ?? "",
    ...(params.encounterId ? { encounterId: params.encounterId } : {}),
    background: params.background,
    objects: [],
    groups: {},
    attacks: [],
    // Never empty: `PlanSchema` requires a slide, because a plan with no layout
    // is not a thing the editor can put a cursor in.
    slides: [makeFirstSlide()],
    schemaVersion: SCHEMA_VERSION,
  };
}
