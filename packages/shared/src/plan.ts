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
 * **5** finished that job for attacks (plan §19.2). An
 * {@link ./attack.js AttackDef} carried the pre-slides model — a base state plus
 * a sparse `overrides` map — for one release longer than a plan did, which left
 * two state models in the codebase and one of them with a single user. A def now
 * carries `slides: [Slide]` like everything else. Plan documents are unaffected
 * in shape; stored attack definitions written at 4 do not parse.
 */
export const SCHEMA_VERSION = 5;

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
 * They stay on one schema because an {@link ./attack.js AttackDef} is genuinely
 * two-state — a start shape, and the one slide its animations reach — and reads
 * `base` as that start.
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
   * On an ordinary object, not just an attack, because "this cone starts at the
   * boss and points at the tank" is a thing a planner wants to say about a shape
   * they drew, without authoring a definition to say it in.
   */
  follow: FollowSchema.optional(),
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
 * A placed instance of a reusable **attack** (plan §17). The plan stores only
 * this reference and a transform; the attack's own objects and animations live
 * in its {@link ./attack.ts AttackDef} and are stamped in at render time by
 * `expandPlan`. That's what makes an attack indivisible — there's nothing in the
 * document to take apart. The planner tunes only placement and timing.
 */
export const AttackInstanceSchema = z.object({
  id: z.string().min(1),
  /** Which attack definition to expand (resolved to the current version). */
  attackId: z.string().min(1),
  /**
   * The slide this attack fires on. *Where* an attack sits is a property of the
   * board and belongs to the plan; *when* it goes off is a property of one slide
   * — so an attack is placed like any other object, and carries the id of the
   * slide that plays it. By id, not index, so reordering slides can't shuffle
   * the encounter's timing.
   */
  slideId: z.string().min(1),
  /**
   * The rectangle the attack is drawn into, in the plan's native pixels —
   * top-left plus size, like every other object. The def's unit space (-1..1) is
   * mapped onto it, so this *is* the placement: a Transformer handle edits it
   * directly (plan §18.2).
   */
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
  /** Degrees clockwise, about the rectangle's origin. */
  rotation: z.number().finite().default(0),
  /**
   * This copy's own origin and direction, overriding the definition's (plan
   * §18.17). Absent — the normal case — means the definition's, because where an
   * attack hangs from is a property of the ability, not of one placement of it.
   * Present when a planner has nudged this particular copy.
   */
  ox: z.number().finite().optional(),
  oy: z.number().finite().optional(),
  dir: z.number().finite().optional(),
  /**
   * What this copy follows, overriding the definition's (plan §18.17).
   *
   * The definition says what the attack *is* — a frontal is always cast from
   * someone — and names its own placeholders. This says which of *this plan's*
   * objects this copy hangs off, named directly, so a shape can be pinned to the
   * boss without the definition having declared a hole for him first.
   */
  follow: FollowSchema.optional(),
  /**
   * What this copy is called, for the author's benefit. The definition's name is
   * what it *is*; this is which one it is — "north cone" against "south cone" —
   * so three copies of one attack can be told apart in a list.
   */
  name: z.string().optional(),
  /** Locked instances can't be dragged or resized, exactly like a locked object. */
  locked: z.boolean().optional(),
  /**
   * Where this attack sits in the board's stacking order — the same scale as an
   * object's `base.z`, so the two interleave. Fractional on purpose: objects
   * renumber themselves 0..n-1 as they come and go, and an attack parked at 2.5
   * stays between them without having to be renumbered too.
   *
   * Absent means **on top of everything**, which is where an attack with no
   * opinion belongs and is where they all sat before they had one.
   */
  z: z.number().finite().optional(),
  /**
   * Absent or `true` means it happens. `false` switches the whole attack off
   * without deleting it — trying a plan without one mechanic is a normal thing
   * to want, and losing its placement to do so isn't.
   */
  visible: z.boolean().optional(),
  /** Delay from the slide's start before the attack begins. */
  startMs: z.number().finite().nonnegative().default(0),
  /**
   * How long the whole attack takes, in ms. Absent means "however long the
   * definition runs" — which is the default, so improving a definition's timing
   * still reaches every plan using it.
   *
   * Setting it **stretches time inside the attack** rather than editing it: an
   * attack that naturally runs 1000ms, placed at 2000ms, plays every part of
   * itself at half speed, in the same order and the same proportions.
   */
  durationMs: z.number().finite().positive().optional(),
  /**
   * Which of *this plan's* objects fill the definition's placeholders (plan
   * §18.14), keyed by the placeholder's id. A definition with placeholders can't
   * be placed until they're all filled — it has holes in it.
   */
  slots: z.record(z.string().min(1), z.string().min(1)).default({}),
  /**
   * Arguments for the definition's declared parameters (plan §18.4), keyed by
   * parameter. This is how a plan tells an attack things only it knows — such as
   * which of *its* objects can set a collision off.
   */
  args: z
    .record(
      z.string().min(1),
      z.union([z.array(z.string()), z.number(), z.string(), z.boolean()]),
    )
    .default({}),
});
export type AttackInstance = z.infer<typeof AttackInstanceSchema>;

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
  /** Optional autoplay dwell before advancing to the next slide. */
  autoAdvanceMs: z.number().finite().nonnegative().optional(),
});
export type Slide = z.infer<typeof SlideSchema>;

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
   * started on a bare map have none. It's what lets the editor offer *this
   * encounter's* pre-designed attacks in the palette.
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
   * Pre-designed attacks placed on the board (plan §17). Like objects they live
   * on the plan, not inside a slide; each names the slide it fires on.
   * `expandPlan` stamps them into concrete objects and animations at render time.
   */
  attacks: z.array(AttackInstanceSchema).default([]),
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
    attacks: [],
    groups: {},
    // Never empty: `PlanSchema` requires a slide, because a plan with no layout
    // is not a thing the editor can put a cursor in.
    slides: [makeFirstSlide()],
    schemaVersion: SCHEMA_VERSION,
  };
}
