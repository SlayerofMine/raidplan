import { z } from "zod";
import { type Pivoted, type Point, type Transform } from "./transform.js";
import {
  FollowSchema,
  isFollowing,
  resolveFollow,
  solveFollow,
  type Follow,
} from "./follow.js";
import { isDeferredTrigger, layoutStepTimeline } from "./timeline.js";
import {
  PlanObjectSchema,
  SCHEMA_VERSION,
  SlideSchema,
  type Anim,
  type AnimParams,
  type AttackInstance,
  type ObjectBase,
  type Plan,
  type PlanObject,
  type Slide,
  type SlideState,
} from "./plan.js";
import { seedState } from "./resolve.js";

/**
 * Reusable attacks (plan §17, remodelled in §18.2).
 *
 * An **AttackDef** is a small bundle of objects and animations authored once (the
 * admin's designer). A plan never stores those internals; it stores an
 * {@link AttackInstance} — an id and a **rectangle** — and {@link expandPlan}
 * stamps the def into that rectangle at render time. So the three renderers draw
 * attacks for free, and an attack is indivisible because its parts aren't in the
 * document to begin with.
 *
 * **Everything inside a def is in unit space: -1..1, centred.** Nothing absolute.
 * `(0,0)` is the middle of the placed rectangle and `±1` its edges, so the same
 * definition works at any size — which is what lets a planner drag a Transformer
 * handle instead of typing pixel coordinates. Lengths are unit lengths, where
 * `2` spans the rectangle: they scale by `w/2` and `h/2` **independently**, so a
 * non-square rectangle stretches the attack (hold Shift to keep the aspect).
 *
 * Unit space is pinned to the attack's **own extent** ({@link attackContentBox}),
 * measured across its whole life — where its parts start, where they settle, and
 * everywhere a motion carries them. So the rectangle a planner grabs is the
 * attack's bounding box, not an arbitrary square it was drawn inside.
 *
 * **Auto-follow:** an instance resolves to the *current* def by `attackId`, so
 * fixing a def improves every plan using it. (`version` is kept for a future
 * "this attack changed" marker and opt-in pinning.)
 *
 * A def is exactly a **base state plus one slide** (§18.2), and since §19.2 it
 * says so in the schema: `objects` are the start, `slides` is a one-element tuple
 * carrying where they settle and the animations that take them there. That slide
 * is an ordinary {@link ./plan.js SlideSchema}, so an attack's internals and a
 * plan's own scenes are one state model rather than two.
 */
/**
 * What a definition can be *told* by the plan that uses it (plan §18.4).
 *
 * Some of an attack's behaviour can't live in the definition, because it refers
 * to things only the plan knows — the canonical case being **which objects set a
 * collision off**. A definition therefore declares parameters, and each placed
 * instance supplies arguments.
 */
export const ATTACK_PARAM_TYPES = [
  /** Ids of objects **in the plan** — e.g. who a pickup can be caught by. */
  "objectRefs",
  "number",
  "color",
  "text",
  "boolean",
] as const;
export const AttackParamTypeSchema = z.enum(ATTACK_PARAM_TYPES);
export type AttackParamType = z.infer<typeof AttackParamTypeSchema>;

export const AttackParamValueSchema = z.union([
  z.array(z.string()),
  z.number(),
  z.string(),
  z.boolean(),
]);
export type AttackParamValue = z.infer<typeof AttackParamValueSchema>;

export const AttackParamSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: AttackParamTypeSchema,
  default: AttackParamValueSchema.optional(),
});
export type AttackParam = z.infer<typeof AttackParamSchema>;

/**
 * Which of a definition's internals read which parameter.
 *
 * Deliberately a small set of **typed slots** keyed by target id, rather than a
 * template language over arbitrary fields: binding stays type-checked and
 * testable, and the general `Plan` schemas don't grow attack-authoring fields.
 *
 * Keying by *target* is what lets one parameter drive several places at once —
 * "the tanks" can be the collision targets of three separate animations — while
 * keeping the reverse unambiguous: a target reads from exactly one parameter.
 */
export const AttackBindingsSchema = z
  .object({
    /** animation id → parameter supplying its collision targets. */
    collideWith: z.record(z.string().min(1), z.string().min(1)).default({}),
    /** animation id → parameter supplying its duration, in ms. */
    durationMs: z.record(z.string().min(1), z.string().min(1)).default({}),
    /** animation id → parameter supplying its delay, in ms. */
    delayMs: z.record(z.string().min(1), z.string().min(1)).default({}),
    /** object id → parameter supplying its tint. */
    tint: z.record(z.string().min(1), z.string().min(1)).default({}),
  })
  .default({ collideWith: {}, durationMs: {}, delayMs: {}, tint: {} });
export type AttackBindings = z.infer<typeof AttackBindingsSchema>;

/**
 * Which library a definition belongs to, and so who may read and write it
 * (plan §19.1).
 *
 * A **union rather than two optional ids**, because "exactly one of these is
 * set" is the whole invariant: a definition scoped to both an encounter and a
 * plan has two different answers to who may edit it, and the type is where that
 * question should be impossible to ask rather than the place it is checked.
 *
 * - `encounter` — the curated library every planner on that fight sees. Written
 *   by site admins, readable by anyone, signed in or not.
 * - `plan` — one plan's own. Written by whoever may edit that plan, readable by
 *   whoever may view it, which is exactly what "confined to their plan" means:
 *   the answer is the plan's ACL, not a second permission system.
 *
 * The `attacks` row carries the same shape as two nullable columns with a CHECK,
 * so a scope can be changed by an UPDATE — which is what promotion is (§19.3).
 */
export const AttackScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("encounter"), encounterId: z.string().min(1) }),
  z.object({ kind: z.literal("plan"), planId: z.string().min(1) }),
]);
export type AttackScope = z.infer<typeof AttackScopeSchema>;

/** The encounter a def belongs to, or `undefined` if it belongs to a plan. */
export const scopeEncounterId = (scope: AttackScope): string | undefined =>
  scope.kind === "encounter" ? scope.encounterId : undefined;

/** The plan a def belongs to, or `undefined` if it belongs to an encounter. */
export const scopePlanId = (scope: AttackScope): string | undefined =>
  scope.kind === "plan" ? scope.planId : undefined;

export const AttackDefSchema = z.object({
  id: z.string().min(1),
  /** Whose attack this is: an encounter's, or one plan's (plan §19.1). */
  scope: AttackScopeSchema,
  name: z.string().min(1),
  /** Bumped on every edit; drives auto-follow's future "changed" marker. */
  version: z.number().int().positive().default(1),
  /**
   * The rectangle a fresh instance gets, in plan pixels: the size the attack was
   * drawn at, measured when it was saved. Not a coordinate space and not typed in
   * by hand — it carries the attack's real proportions, so a long beam doesn't
   * arrive square. The planner resizes freely afterwards.
   */
  defaultSize: z
    .object({
      w: z.number().finite().positive(),
      h: z.number().finite().positive(),
    })
    .default({ w: 400, h: 400 }),
  /** Start state, in unit space — each part's `base` is where it begins. */
  objects: z.array(PlanObjectSchema),
  /**
   * The def's **one slide**, in unit space: where its parts settle, and the
   * animations that carry them there (plan §19.2).
   *
   * A tuple, so "exactly one" is the schema's job rather than a comment — §18.2
   * codified the constraint and this is where it is now enforced. The slide is
   * an ordinary {@link SlideSchema}, carrying a *complete* state per part like
   * every slide in every plan, which is the whole point: one state model, so a
   * change to how a slide resolves cannot apply to plans and miss attacks.
   */
  slides: z.tuple([SlideSchema]),
  /**
   * The whole bundle's **origin and direction**, in unit space (plan §18.17).
   *
   * `ox`/`oy` are fractions of the placed rectangle, so `0, 0.5` is the middle
   * of its left edge — where a frontal is cast from. `dir` is the angle the
   * attack was drawn pointing, in degrees clockwise from +x.
   *
   * These belong to the definition rather than to each placement because where a
   * frontal comes out of the caster is a fact about the ability. A planner who
   * disagrees can override all three on the instance.
   */
  ox: z.number().finite().optional(),
  oy: z.number().finite().optional(),
  dir: z.number().finite().optional(),
  /**
   * What the attack follows by default (plan §18.17), naming the definition's
   * own **placeholders** — the holes the plan fills. A frontal ships as
   * `{ pin: caster, aim: target }` so it arrives already knowing it is cast from
   * someone at someone, and the planner only says who.
   *
   * Only the placement is taken over. The attack keeps its own size, because a
   * frontal's reach is the ability's, not the distance to whoever it's aimed at.
   *
   * Replaces §18.15's `anchor` and §18.16's `lookAts`: a definition's *part* now
   * carries its own `follow` like any other object, so an indicator that tracks
   * the attack's orb is the same mechanism as the attack tracking the boss.
   */
  follow: FollowSchema.optional(),
  /** What a plan must (or may) tell this attack (plan §18.4). */
  params: z.array(AttackParamSchema).default([]),
  /** Which internals read which parameter. */
  bindings: AttackBindingsSchema,
});
export type AttackDef = z.infer<typeof AttackDefSchema>;

/** The editable body of an attack — everything but its identity and version. */
export type AttackContent = Omit<AttackDef, "id" | "scope" | "version">;

/**
 * The geometric half of a definition: its parts and its slide, and nothing about
 * its identity, name or parameters. What {@link attackContentBox} measures, so
 * the designer can measure a body it has not saved yet.
 */
export interface AttackBody {
  objects: PlanObject[];
  slides: readonly [Slide];
}

/** A definition's one slide: where its parts settle, and what carries them there. */
export const defSlide = (def: { slides: readonly [Slide] }): Slide =>
  def.slides[0];

/** A definition's animations — the ones on its single slide. */
export const defAnims = (def: { slides: readonly [Slide] }): Anim[] =>
  def.slides[0].animations;

/**
 * The distinct attack ids a plan references, so a renderer can fetch just the
 * definitions it needs before calling {@link expandPlan}.
 */
export function attackIdsInPlan(plan: Plan): string[] {
  const ids = new Set<string>();
  for (const instance of plan.attacks) ids.add(instance.attackId);
  return [...ids];
}

/**
 * How long a definition runs on its own — its **natural** length.
 *
 * An instance may be stretched away from this ({@link AttackInstance.durationMs}),
 * which scales the whole bundle rather than editing it. Both the timeline's bar
 * and the expansion read the length from here, so a bar can't disagree with what
 * plays.
 */
export function attackNaturalMs(def: AttackDef): number {
  return layoutStepTimeline(defAnims(def)).totalMs;
}

/** How long a *placed* attack runs: its own duration if stretched, else the def's. */
export function attackSpanMs(def: AttackDef, instance: AttackInstance): number {
  return instance.durationMs ?? attackNaturalMs(def);
}

/**
 * The rectangle a placed attack occupies, with the origin and direction it
 * actually uses — its own if it has been nudged, else its definition's.
 *
 * The definition owns these because they describe the ability: a frontal comes
 * out of the caster's feet whoever places it. The instance can still disagree,
 * field by field, which is why this is a merge rather than a choice.
 */
export function attackTransform(
  def: AttackDef,
  instance: AttackInstance,
): Transform {
  return {
    x: instance.x,
    y: instance.y,
    w: instance.w,
    h: instance.h,
    rotation: instance.rotation,
    ox: instance.ox ?? def.ox,
    oy: instance.oy ?? def.oy,
    dir: instance.dir ?? def.dir,
  };
}

/**
 * What a placed attack follows, in the plan's own ids.
 *
 * An instance's own `follow` names the plan's objects directly and wins
 * outright — a planner who has said "pin this copy to the boss" has said
 * something more specific than the definition could. Otherwise the definition's
 * follow is read, and its ids are **placeholders**, so they go through `slots`
 * to become plan objects. A definition that asks to hang off a hole nobody
 * filled follows nothing, which leaves the attack where it was dropped.
 */
export function attackFollow(
  def: AttackDef,
  instance: AttackInstance,
): Follow | undefined {
  if (isFollowing(instance.follow)) return instance.follow;
  if (!isFollowing(def.follow)) return undefined;
  const pin = def.follow?.pin ? instance.slots[def.follow.pin] : undefined;
  const aim = def.follow?.aim ? instance.slots[def.follow.aim] : undefined;
  return { ...(pin ? { pin } : {}), ...(aim ? { aim } : {}) };
}

/**
 * Where a following attack's rectangle goes, given where the objects it follows
 * are *right now* (plan §18.17).
 *
 * A thin resolve-then-delegate: everything geometric lives in `solveFollow`, so
 * a whole attack, one of its parts and an ordinary plan object are all placed by
 * the same maths. Returns `null` for "leave the placement alone" — the stored
 * rectangle stands.
 */
export function attackPlacement(
  def: AttackDef,
  instance: AttackInstance,
  centreOf: (objectId: string) => Point | null,
): { x: number; y: number; rotation: number } | null {
  return solveFollow(
    attackTransform(def, instance),
    attackFollow(def, instance),
    centreOf,
  );
}

/** An axis-aligned box: a centre and half-extents. Never zero-sized. */
export interface AttackBox {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
}

/** Unit space itself: -1..1 on both axes, centred on the origin. */
const UNIT_BOX: AttackBox = { cx: 0, cy: 0, hx: 1, hy: 1 };

/** A box can't have a zero half-extent, or mapping through it divides by zero. */
const MIN_HALF = 1e-6;

const boxFrom = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): AttackBox => ({
  cx: (minX + maxX) / 2,
  cy: (minY + maxY) / 2,
  hx: Math.max((maxX - minX) / 2, MIN_HALF),
  hy: Math.max((maxY - minY) / 2, MIN_HALF),
});

/** The rectangle an instance was placed at, as a box. */
const instanceBox = (i: AttackInstance): AttackBox => ({
  cx: i.x + i.w / 2,
  cy: i.y + i.h / 2,
  hx: i.w / 2,
  hy: i.h / 2,
});

/** The four corners of a transform, rotated clockwise about its own origin. */
function cornersOf(t: {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}): Point[] {
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [0, 0],
    [t.w, 0],
    [t.w, t.h],
    [0, t.h],
  ].map(([dx, dy]) => ({
    x: t.x + dx! * cos - dy! * sin,
    y: t.y + dx! * sin + dy! * cos,
  }));
}

/** The centre of a placed rectangle — the point a pin lands a follower's origin on. */
function rectCentre(t: Pivoted): Point {
  const [topLeft, , bottomRight] = cornersOf(t);
  return {
    x: (topLeft!.x + bottomRight!.x) / 2,
    y: (topLeft!.y + bottomRight!.y) / 2,
  };
}

/**
 * Every transform one object passes through, before anything it follows is
 * accounted for: where it starts, where the slide leaves it, and everywhere a
 * motion carries it.
 */
function authoredPlacements(o: PlanObject, content: AttackBody): Pivoted[] {
  const base = o.base;
  const slide = defSlide(content);
  // The slide states what the part settles as, completely — but a part the
  // slide doesn't carry simply isn't in the settled scene, and stays put.
  const placements: Pivoted[] = [base, { ...base, ...slide.states[o.id] }];

  for (const anim of slide.animations) {
    if (anim.objectId !== o.id || !anim.params) continue;
    const { toX, toY, path } = anim.params;
    // A motion target is a *position* for the object, so the whole footprint
    // travels there.
    if (toX !== undefined && toY !== undefined) {
      placements.push({ ...base, x: toX, y: toY });
    }
    // A waypoint says where the object's *centre* passes, so the footprint it
    // really sweeps is half a size off from this. Deliberately not corrected
    // for: this box is what unit space is normalised against, so shifting it
    // would silently re-scale every stored definition that has a path, to
    // sharpen a bound that is a hint either way. Attack definitions don't
    // author paths today; plan-level routes never come through here.
    for (const point of path ?? []) {
      placements.push({ ...base, x: point.x, y: point.y });
    }
  }
  return placements;
}

/** A follower crossed with everything it follows stays small in practice; cap it anyway. */
const MAX_PLACEMENTS = 4096;

/**
 * The same placements with the object's {@link Follow} solved — which for a
 * pinned part is the whole story, not a correction to it.
 *
 * `useFollowing` re-places a follower every frame, *after* the tween engine has
 * written that frame's positions. So where a pinned part was authored, and
 * everywhere its own motion would otherwise have carried it, is overruled by
 * wherever the pin is — and reading `base` here, as this used to, measured a
 * rectangle nothing is ever drawn in. Dragging the origin handle of a pinned
 * object made that visible: `slidePinnedOrigin` walks the box out from under a
 * fixed pin on purpose, so the stored `x/y` slide away while the artwork holds
 * still, and the bounds drifted off with them.
 *
 * Crossed with *every* placement of the target, because a pin rides whatever it
 * hangs off: pin a part to something that flies 500px right and the part goes
 * with it, so the attack's footprint has to cover the trip.
 *
 * Ids resolve inside this content, which is where a definition's parts follow
 * each other. A follow pointing outside it — at one of the plan's own objects,
 * through a placeholder — has no answer here, and {@link solveFollow} already
 * means "leave the placement alone" in exactly that case.
 */
function solvedPlacements(
  o: PlanObject,
  authored: Map<string, Pivoted[]>,
  byId: Map<string, PlanObject>,
  solved: Map<string, Pivoted[]>,
  resolving: Set<string>,
): Pivoted[] {
  const done = solved.get(o.id);
  if (done) return done;

  const own = authored.get(o.id) ?? [o.base];
  // A ring of follows has no fixed point to settle on; leave it as authored
  // rather than picking an arbitrary member to break it at.
  if (!isFollowing(o.follow) || resolving.has(o.id)) return own;

  resolving.add(o.id);
  const centresOf = (id: string): (Point | null)[] => {
    const target = byId.get(id);
    // A tether's own transform is degenerate — it has no centre to offer.
    if (!target || target.type === "tether") return [null];
    const centres = solvedPlacements(
      target,
      authored,
      byId,
      solved,
      resolving,
    ).map(rectCentre);
    return centres.length > 0 ? centres : [null];
  };
  const pins = o.follow?.pin ? centresOf(o.follow.pin) : [null];
  const aims = o.follow?.aim ? centresOf(o.follow.aim) : [null];
  resolving.delete(o.id);

  const placed: Pivoted[] = [];
  for (const t of own) {
    for (const pin of pins) {
      for (const aim of aims) {
        if (placed.length >= MAX_PLACEMENTS) break;
        // Pin and aim are asked for by id, so a follow that names the same
        // object for both gets the one centre — which is what that means.
        const at = solveFollow(t, o.follow, (id) =>
          id === o.follow?.pin ? pin : aim,
        );
        placed.push(at ? { ...t, ...at } : t);
      }
    }
  }

  solved.set(o.id, placed);
  return placed;
}

/**
 * Everything an attack covers **over its whole life**: where its parts start,
 * where they settle, and everywhere a motion carries them in between.
 *
 * This box *is* the attack, and it's what an instance's rectangle is mapped onto
 * — so the frame a planner grabs hugs the artwork instead of floating around it.
 * Returns `null` for an attack with nothing in it.
 *
 * Parts that follow other parts are measured where the follow puts them, not
 * where they were authored — see {@link solvedPlacements}.
 *
 * Tethers are skipped: their geometry comes from their endpoints, so their own
 * transform is degenerate and would drag the box to the origin.
 */
export function attackContentBox(content: AttackBody): AttackBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (p: Point) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };

  // Every object can be *followed*, including the ones with no extent of their
  // own: a placeholder is a real rectangle on the designer's canvas, and it is
  // the natural thing to pin a part to.
  const byId = new Map(content.objects.map((o) => [o.id, o]));
  const authored = new Map(
    content.objects.map((o) => [o.id, authoredPlacements(o, content)]),
  );
  const solved = new Map<string, Pivoted[]>();

  for (const o of content.objects) {
    // A tether is drawn from its endpoints, and a placeholder stands for an
    // object that could be anywhere — neither has an extent of its own.
    if (o.type === "tether" || o.type === "placeholder") continue;
    for (const t of solvedPlacements(o, authored, byId, solved, new Set())) {
      for (const corner of cornersOf(t)) add(corner);
    }
  }

  return Number.isFinite(minX) ? boxFrom(minX, minY, maxX, maxY) : null;
}

/** The box a definition's own coordinates occupy — unit space when normalised. */
const defBox = (def: AttackDef): AttackBox => attackContentBox(def) ?? UNIT_BOX;

/**
 * Map a point from one box to another, then rotate it clockwise about the
 * destination's centre (Konva's y-down convention). The single primitive behind
 * both placing an attack into a plan and moving it on and off the designer's
 * canvas.
 */
function mapPoint(
  p: Point,
  from: AttackBox,
  to: AttackBox,
  rotation = 0,
): Point {
  const dx = ((p.x - from.cx) / from.hx) * to.hx;
  const dy = ((p.y - from.cy) / from.hy) * to.hy;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: to.cx + dx * cos - dy * sin,
    y: to.cy + dx * sin + dy * cos,
  };
}

/**
 * Where an attack sits in the board's stack. Absent means on top of everything.
 *
 * Its parts are drawn just above it, in the definition's own order, so an attack
 * stays a single layer of the board however many pieces it has.
 */
export const attackZ = (instance: AttackInstance): number =>
  instance.z ?? Number.MAX_SAFE_INTEGER;

/** Namespaced id so two instances of the same def never collide. */
const scopedId = (instanceId: string, localId: string) =>
  `${instanceId}::${localId}`;

/**
 * The **placeholders** a definition leaves for the using plan to fill (plan
 * §18.14) — holes it can't fill itself, because they stand for objects only the
 * plan knows: the boss, the tank a frontal is aimed at.
 *
 * Distinct from a parameter, which supplies a *value*. A placeholder stands in
 * the definition's own object list, so it can be tethered to, aimed at and
 * collided with while authoring, and every one of those references follows the
 * plan's object once it's filled.
 */
export function attackSlots(def: AttackDef): PlanObject[] {
  return def.objects.filter((o) => o.type === "placeholder");
}

/** Every placeholder filled? A definition with holes in it can't be placed. */
export function slotsFilled(
  def: AttackDef,
  slots: Record<string, string>,
): boolean {
  return attackSlots(def).every((slot) => Boolean(slots[slot.id]));
}

/**
 * Objects an entrance effect brings on screen during the attack. They're
 * authored hidden (or become hidden when materialised) and the animation is what
 * reveals them, so their settled state must be *visible* even though their base
 * isn't.
 */
function entranceTargets(def: AttackDef): Set<string> {
  const ids = new Set<string>();
  for (const anim of defAnims(def)) {
    if (anim.kind === "entrance") ids.add(anim.objectId);
  }
  return ids;
}

/** Move an object's base transform from one box to another. */
function mapBase(
  base: ObjectBase,
  from: AttackBox,
  to: AttackBox,
  rotation = 0,
): ObjectBase {
  const p = mapPoint({ x: base.x, y: base.y }, from, to, rotation);
  return {
    ...base,
    x: p.x,
    y: p.y,
    w: (base.w / from.hx) * to.hx,
    h: (base.h / from.hy) * to.hy,
    rotation: base.rotation + rotation,
  };
}

/**
 * Move a slide state — a part's settled position and size — from one box to
 * another.
 *
 * The same arithmetic as {@link mapBase}, and now genuinely the same shape:
 * every field is present, so there is nothing to fill in from elsewhere. That is
 * the drift §19.2 removed. A sparse override had to borrow its missing
 * coordinate from `base` before it could be turned, because a rotation mixes the
 * axes — "ends 30 to the right" stops being an x alone the moment the attack is
 * rotated — and getting that borrow wrong moved a part to the origin.
 */
function mapSlideState(
  state: SlideState,
  from: AttackBox,
  to: AttackBox,
  rotation = 0,
): SlideState {
  const p = mapPoint({ x: state.x, y: state.y }, from, to, rotation);
  return {
    ...state,
    x: p.x,
    y: p.y,
    w: (state.w / from.hx) * to.hx,
    h: (state.h / from.hy) * to.hy,
    rotation: state.rotation + rotation,
  };
}

/** Move an animation's spatial params (motion targets and paths). */
function mapParams(
  params: AnimParams,
  from: AttackBox,
  to: AttackBox,
  rotation = 0,
): AnimParams {
  const next: AnimParams = { ...params };
  if (params.toX !== undefined && params.toY !== undefined) {
    const p = mapPoint({ x: params.toX, y: params.toY }, from, to, rotation);
    next.toX = p.x;
    next.toY = p.y;
  }
  if (params.path) {
    next.path = params.path.map((pt) => mapPoint(pt, from, to, rotation));
  }
  return next;
}

/** Stamp a single instance of a def into concrete objects + animations. */
function expandInstance(
  def: AttackDef,
  instance: AttackInstance,
): {
  objects: PlanObject[];
  animations: Anim[];
  /** Each part's state on the attack's own slide — where it comes to rest. */
  settled: Record<string, SlideState>;
} {
  // The def's own extent is mapped onto the instance's rectangle, so the frame
  // hugs the attack whatever coordinates it happens to be authored in.
  const from = defBox(def);
  const to = instanceBox(instance);
  const spin = instance.rotation;
  const slide = defSlide(def);
  const entrances = entranceTargets(def);

  /** An argument the plan supplied, else the parameter's declared default. */
  const argOf = (key: string): AttackParamValue | undefined =>
    instance.args[key] ?? def.params.find((p) => p.key === key)?.default;

  /**
   * A definition's own id, resolved. A placeholder resolves to whichever of the
   * plan's objects was put in it — un-namespaced, because it *is* that object —
   * so every reference to the placeholder follows suit: tether ends, collision
   * targets, animation targets. Everything else is namespaced as usual.
   */
  const resolveId = (localId: string): string =>
    instance.slots[localId] ?? scopedId(instance.id, localId);

  // The attack occupies one place in the board's stack; its parts share it,
  // separated by a hair so the definition's own order survives the sort.
  const baseZ = attackZ(instance);
  const objects = def.objects
    // A placeholder is a hole, not a part: the plan's object is already on the
    // board, and materialising a second copy of it would be a lie.
    .filter((o) => o.type !== "placeholder")
    .map((o, index) => {
      const tint = argOf(def.bindings.tint[o.id] ?? "");
      const placed = {
        ...mapBase(o.base, from, to, spin),
        z: baseZ + index * Number.EPSILON,
        // Materialised hidden; the attack's slide is what reveals it.
        visible: false,
      };
      return {
        ...o,
        id: scopedId(instance.id, o.id),
        // Every part of one attack belongs together — which is what lets a
        // renderer put them in a single node and move that node (§18.15).
        groupId: instance.id,
        ...(o.fromId ? { fromId: resolveId(o.fromId) } : {}),
        ...(o.toId ? { toId: resolveId(o.toId) } : {}),
        // A part that follows something goes through the same choke point as a
        // tether end, so it can name a sibling part *or* — through a filled
        // placeholder — one of the plan's own objects (§18.17).
        ...(isFollowing(o.follow)
          ? { follow: resolveFollow(o.follow, resolveId) }
          : {}),
        base: typeof tint === "string" ? { ...placed, tint } : placed,
      };
    });

  // A parameter can change when a part runs and for how long, so bound timings
  // are settled first — the chain below lays out against the result.
  const effective: Anim[] = defAnims(def).map((a) => {
    const duration = argOf(def.bindings.durationMs[a.id] ?? "");
    const delay = argOf(def.bindings.delayMs[a.id] ?? "");
    return {
      ...a,
      ...(typeof duration === "number" ? { durationMs: duration } : {}),
      ...(typeof delay === "number" ? { delayMs: delay } : {}),
    };
  });

  // Resolve the def's own trigger chain *before* it joins the host slide, using
  // the very rules the player will apply to it. An attack is one indivisible
  // bundle: its internals must not chain off whatever the plan happens to have
  // animated just before, and `startMs` must shift it exactly once.
  const layout = layoutStepTimeline(effective);
  const spans = new Map(layout.spans.map((s) => [s.animId, s]));

  // A placed attack can be stretched or compressed in time. That scales the
  // whole bundle — every delay and every duration — so it plays out exactly as
  // authored, just slower or faster. An attack with no length can't be
  // stretched, and an instance that says nothing keeps following its definition.
  const stretch =
    instance.durationMs && layout.totalMs > 0
      ? instance.durationMs / layout.totalMs
      : 1;

  const animations: Anim[] = effective.map((a) => {
    // A bound collideWith names objects in the **plan**, so those ids are used
    // as given; only a definition's own literal ids get namespaced.
    const boundTargets = argOf(def.bindings.collideWith[a.id] ?? "");
    const collideWith = Array.isArray(boundTargets)
      ? boundTargets
      : a.collideWith?.map(resolveId);

    return {
      ...a,
      id: scopedId(instance.id, a.id),
      objectId: resolveId(a.objectId),
      ...(collideWith ? { collideWith } : {}),
      durationMs: a.durationMs * stretch,
      // A deferred animation is timed from the event that fires it (a click, a
      // collision), not from the slide, so it keeps its own delay — stretched
      // like everything else, because it's still part of this attack.
      ...(isDeferredTrigger(a.trigger)
        ? { delayMs: a.delayMs * stretch }
        : {
            trigger: "onEnter" as const,
            delayMs:
              instance.startMs +
              (spans.get(a.id)?.startMs ?? a.delayMs) * stretch,
          }),
      ...(a.params ? { params: mapParams(a.params, from, to, spin) } : {}),
    };
  });

  // An attack's parts are materialised hidden so they can't show on the slides
  // around it, which leaves the author on the hook for an entrance on every
  // single one. Give the ones that have none an implicit `appear` when the
  // attack fires — otherwise the attack plays out invisibly (the slide's end
  // state alone can't reveal it, because nothing tweens `visible`).
  for (const o of def.objects) {
    if (o.type === "placeholder") continue;
    if (!o.base.visible || entrances.has(o.id)) continue;
    animations.unshift({
      id: scopedId(instance.id, `${o.id}#enter`),
      objectId: scopedId(instance.id, o.id),
      kind: "entrance",
      effect: "appear",
      trigger: "onEnter",
      delayMs: instance.startMs,
      durationMs: 0,
      easing: "none",
    });
  }

  // What the def's slide actually *changes* about each part, placed. An
  // animation that states no target of its own takes one from here, so only a
  // real change may supply it: a part the slide leaves exactly where it started
  // must not hand a `move` a target identical to its own start.
  //
  // The old sparse `overrides` map stored that difference directly. A complete
  // slide state says what the settled scene *is* rather than how it differs, so
  // the difference is recovered here — which is the one thing §19.2 costs, and
  // is worth a single comparison to have one state model.
  const settledOf = new Map<string, Partial<SlideState>>();
  /** Where each part comes to rest, complete — the state its slide shows. */
  const settled: Record<string, SlideState> = {};
  const placedOf = new Map(objects.map((o) => [o.id, o]));

  for (const o of def.objects) {
    if (o.type === "placeholder") continue;
    const id = scopedId(instance.id, o.id);
    const end = slide.states[o.id];
    const placed = end ? mapSlideState(end, from, to, spin) : undefined;

    // The state this part is *parked* in: where the def's slide leaves it, and
    // visible unless the author meant it hidden. A part authored hidden that
    // has an entrance ends up on screen — the entrance is how it arrives — but
    // one the author hid on purpose (an exit, a part that never comes on) stays
    // hidden, which is why this reads `end.visible` first.
    const part = placedOf.get(id);
    if (part) {
      // No entry on the def's slide means the part isn't in the settled scene,
      // so it rests where it started — the mapped start geometry it was
      // materialised with.
      settled[id] = {
        ...(placed ?? seedState(part)),
        visible:
          (placed?.visible ?? o.base.visible) ||
          (!o.base.visible && entrances.has(o.id)),
      };
    }

    // A part the slide doesn't carry isn't in the settled scene at all, so
    // there is nothing for it to settle *as*, and nothing for an animation with
    // no target of its own to take from it.
    if (!end || !placed) continue;
    const changed = changedFields(seedState(o), end);
    if (changed.length === 0) continue;

    const delta: Partial<SlideState> = {};
    for (const key of changed) Object.assign(delta, { [key]: placed[key] });
    // x and y travel together: a rotation mixes the axes, so "ends 30 to the
    // right" stops being an x alone the moment the attack is turned.
    if (changed.includes("x") || changed.includes("y")) {
      delta.x = placed.x;
      delta.y = placed.y;
    }
    settledOf.set(id, delta);
  }

  // The adapter, in one place. A def is authored as two states — a start shape
  // and the one slide its animations reach. A *plan's* animations state their
  // own targets. So the settled state is handed to the animations that are
  // supposed to produce it, here, at the seam: nothing downstream has to know a
  // def says it the other way round.
  const startOf = new Map(objects.map((o) => [o.id, o.base]));
  return {
    objects,
    settled,
    animations: animations.map((a) =>
      withDerivedTarget(a, startOf.get(a.objectId), settledOf.get(a.objectId)),
    ),
  };
}

/**
 * Give an expanded animation the target its definition expressed as an end
 * state, unless it already carries one of its own.
 *
 * Only the effects that *go* somewhere need it: a pulse or a blink returns to
 * where it started and has nothing to take from an end state.
 */
function withDerivedTarget(
  anim: Anim,
  start: ObjectBase | undefined,
  end: Partial<SlideState> | undefined,
): Anim {
  if (!end || !start) return anim;
  const params = anim.params ?? {};
  switch (anim.effect) {
    case "move":
      if (params.toX !== undefined || params.toY !== undefined) return anim;
      if (end.x === undefined && end.y === undefined) return anim;
      return {
        ...anim,
        params: { ...params, toX: end.x ?? start.x, toY: end.y ?? start.y },
      };
    case "scale": {
      if (params.scale !== undefined) return anim;
      // The def says "ends this big"; a plan's scale says "by this much".
      if (end.w === undefined || start.w === 0) return anim;
      return { ...anim, params: { ...params, scale: end.w / start.w } };
    }
    case "fade":
      if (params.toOpacity !== undefined || anim.kind === "exit") return anim;
      if (end.opacity === undefined) return anim;
      return { ...anim, params: { ...params, toOpacity: end.opacity } };
    default:
      return anim;
  }
}

/**
 * Expand every attack instance in `plan` into concrete objects and animations,
 * returning an ordinary {@link Plan} that any renderer already understands.
 *
 * Each attack's objects exist **only during their slide**: they carry the def's
 * settled state on that slide, and a hidden copy of their *unplayed* state on
 * every other. That settled state is what a renderer draws when the slide is
 * parked — but nothing tweens `visible`, so mid-playback an attack is revealed
 * by an entrance effect instead: the def's own, or an implicit `appear` at the
 * instant the attack fires.
 *
 * The hidden copies keep the def's **start** geometry rather than its end, which
 * is not cosmetic: the slide before an attack's is where playback reads the
 * attack's start state from, so seeding those with the end geometry would give
 * every animation inside the attack zero distance to cover.
 *
 * The def's animations are flattened onto absolute delays on the way in, so an
 * attack keeps its own timing no matter what else shares the slide.
 *
 * Pure and non-mutating. An instance that is switched off, or whose `attackId`
 * isn't in `defsById`, or whose slide has been deleted, is skipped — either
 * leaves the rest of the plan renderable, like a missing background. A plan with
 * no attacks is returned untouched, so the common case costs nothing.
 */
export function expandPlan(
  plan: Plan,
  defsById: Record<string, AttackDef>,
): Plan {
  if (plan.attacks.length === 0) return plan;

  const objects: PlanObject[] = [...plan.objects];
  const slides: Slide[] = plan.slides.map((s) => ({
    ...s,
    states: { ...s.states },
    animations: [...s.animations],
  }));
  const indexOfSlide = new Map(plan.slides.map((s, i) => [s.id, i]));

  for (const instance of plan.attacks) {
    const def = defsById[instance.attackId];
    const slideIndex = indexOfSlide.get(instance.slideId);
    // A missing def or a slide that's been deleted leaves the rest of the plan
    // renderable, like a missing background. A switched-off attack simply
    // doesn't happen: it stays in the document, and out of the expansion.
    if (!def || slideIndex === undefined || instance.visible === false)
      continue;

    const expanded = expandInstance(def, instance);
    objects.push(...expanded.objects);

    for (const object of expanded.objects) {
      // Materialised hidden (see `expandInstance`), so the seed *is* the
      // unplayed state — what the attack looks like before it goes off, and now
      // also what its own slide *opens* on. Its animations take it from there;
      // the slide no longer states where it ends up, because the animations do.
      const unplayed: SlideState = { ...seedState(object), visible: false };
      // On every slide, so a part is never a missing object mid-plan — hidden
      // everywhere, revealed only by the animations on the slide that fires it.
      for (const slide of slides) slide.states[object.id] = { ...unplayed };
    }
    slides[slideIndex]!.animations.push(...expanded.animations);
  }

  // Draw order is `base.z`, and a renderer walks the array — so the array has to
  // be in z order for an attack to sit under the token standing on it. Stable,
  // so objects and an attack's own parts keep the order they were given.
  objects.sort((a, b) => a.base.z - b.base.z);
  return { ...plan, objects, slides, attacks: [] };
}

/**
 * The synthetic background an attack is authored on: a plain square the size of
 * {@link ATTACK_AUTHORING_SIZE}. `getBackgroundSrc` doesn't recognise it, so it
 * renders as an empty floor — the designer draws on a blank grid, not a map.
 */
export const ATTACK_BOX_ASSET = "attack-box";

/**
 * The designer's canvas, in pixels: a square to draw on, and nothing more.
 *
 * The editor works in pixels everywhere — drag, snapping, the properties panel —
 * so the designer authors here and the two conversions below are the only place
 * unit space is entered or left. Storage and expansion stay unit-only.
 *
 * It is deliberately **not** the coordinate space: an attack's own extent is,
 * which is why an attack drawn small in one corner still fills the rectangle a
 * planner drops it into.
 */
export const ATTACK_AUTHORING_SIZE = 1000;

const mapAnim = (a: Anim, from: AttackBox, to: AttackBox): Anim => ({
  ...a,
  ...(a.params ? { params: mapParams(a.params, from, to) } : {}),
});

/** The designer's two slides: what the attack starts as, and what it becomes. */
export const ATTACK_START_SLIDE = "attack-start";
export const ATTACK_END_SLIDE = "attack-end";

/**
 * Present an {@link AttackDef} as a **two-slide** {@link Plan} the editor store
 * can load, so the attack designer *is* the editor (plan §17 stage 4 / §18.2).
 *
 * A def is two-state — a `base` shape and the one slide its animations reach —
 * because that is genuinely what an attack is, and a planner never sees its
 * internals as slides. Slide 0 is the def's base, slide 1 its own slide; the
 * designer labels them **Start** and **End**.
 *
 * Since §19.2 the second slide is the def's slide *itself*, moved into pixels
 * and otherwise passed through. This function and its inverse used to translate
 * between two state models on the way past; now they only change coordinates.
 *
 * The def is laid out at the size a fresh instance gets, centred on the canvas:
 * what the author draws is life-size, so "how big is this attack" is answered by
 * looking at it rather than by typing numbers.
 */
export function defToPlan(def: AttackDef): Plan {
  const size = ATTACK_AUTHORING_SIZE;
  const from = defBox(def);
  const to: AttackBox = {
    cx: size / 2,
    cy: size / 2,
    hx: def.defaultSize.w / 2,
    hy: def.defaultSize.h / 2,
  };

  const slide = defSlide(def);
  const objects = def.objects.map((o) => ({
    ...o,
    base: mapBase(o.base, from, to),
  }));

  // A def is one scene in two states, so both slides carry every part: Start is
  // the mapped base, End the mapped slide. A part the def's slide doesn't carry
  // is put on End where it started, because the designer edits both slides as
  // one cast (`sharedCast`) and a part missing from End would read as deleted.
  const start: Record<string, SlideState> = {};
  const end: Record<string, SlideState> = {};
  for (const o of objects) {
    start[o.id] = seedState(o);
    const settled = slide.states[o.id];
    end[o.id] = settled ? mapSlideState(settled, from, to) : seedState(o);
  }

  return {
    id: def.id,
    title: def.name,
    raid: "",
    background: { assetId: ATTACK_BOX_ASSET, width: size, height: size },
    objects,
    attacks: [],
    groups: {},
    slides: [
      { id: ATTACK_START_SLIDE, name: "Start", states: start, animations: [] },
      {
        id: ATTACK_END_SLIDE,
        name: "End",
        states: end,
        // The animations are what carries Start into End, so they belong to the
        // slide they arrive at — the same rule every other plan follows, and
        // since §19.2 the very slide they are stored on.
        animations: slide.animations.map((a) => mapAnim(a, from, to)),
      },
    ],
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * Read the designer's two slides back as a def's body — the inverse of the
 * Start/End split {@link defToPlan} made.
 *
 * Slide 0's layout *is* each object's base; slide 1 *is* the def's slide. Since
 * §19.2 that second half is a copy rather than a diff: both models say the same
 * thing in the same shape, so there is nothing left to translate.
 *
 * Exported because the designer's bounds overlay has to measure exactly what a
 * save would store, and rebuilding this by hand there is how the outline and the
 * saved `defaultSize` drift apart.
 */
export function attackContentOf(plan: Plan): AttackBody {
  const start = plan.slides[0];
  const end = plan.slides[1];
  const objects = plan.objects.map((o) => {
    const state = start?.states[o.id];
    return state ? { ...o, base: { ...o.base, ...state } } : o;
  });
  // A def's slide keeps the designer's End slide identity, so a round trip
  // through the store leaves the same document it loaded.
  const slide: Slide = end ?? {
    id: ATTACK_END_SLIDE,
    name: "End",
    states: {},
    animations: [],
  };
  return { objects, slides: [slide] };
}

/** Which fields of `to` actually differ from `from`. */
function changedFields(from: SlideState, to: SlideState): (keyof SlideState)[] {
  return (Object.keys(to) as (keyof SlideState)[]).filter(
    (key) => to[key] !== from[key],
  );
}

/**
 * Extract an attack's editable body back out of the designer's plan, normalising
 * it to unit space. The inverse of {@link defToPlan}.
 *
 * Normalising means **shrink-wrapping**: the box the attack actually occupies
 * becomes -1..1, and its pixel size becomes `defaultSize`. That's what makes the
 * frame a planner grabs hug the artwork, keeps a long beam from arriving square,
 * and makes the stored definition its own thumbnail. An empty attack keeps the
 * default rectangle, because there's nothing to wrap.
 */
export function planToAttackContent(
  plan: Plan,
  meta: {
    name: string;
    params?: AttackParam[];
    bindings?: AttackBindings;
    ox?: number;
    oy?: number;
    dir?: number;
    follow?: Follow;
  },
): AttackContent {
  const content = attackContentOf(plan);
  const from = attackContentBox(content);
  const defaultSize = from
    ? { w: from.hx * 2, h: from.hy * 2 }
    : { w: 400, h: 400 };

  const box = from ?? UNIT_BOX;
  const slide = defSlide(content);
  const states: Record<string, SlideState> = {};
  for (const [id, state] of Object.entries(slide.states)) {
    states[id] = mapSlideState(state, box, UNIT_BOX);
  }
  return {
    name: meta.name,
    defaultSize,
    objects: content.objects.map((o) => ({
      ...o,
      base: mapBase(o.base, box, UNIT_BOX),
    })),
    slides: [
      {
        ...slide,
        states,
        animations: slide.animations.map((a) => mapAnim(a, box, UNIT_BOX)),
      },
    ],
    // Parameters and bindings aren't spatial, so they pass straight through from
    // the designer rather than round-tripping via the canvas. The origin and
    // direction *are* spatial but already box-relative — `ox`/`oy` are fractions
    // of the very box being normalised here — so they come through untouched too.
    ...(meta.ox !== undefined ? { ox: meta.ox } : {}),
    ...(meta.oy !== undefined ? { oy: meta.oy } : {}),
    ...(meta.dir !== undefined ? { dir: meta.dir } : {}),
    ...(isFollowing(meta.follow) ? { follow: meta.follow } : {}),
    params: meta.params ?? [],
    bindings: meta.bindings ?? {
      collideWith: {},
      durationMs: {},
      delayMs: {},
      tint: {},
    },
  };
}

/**
 * The node id a renderer gives the group holding one attack's parts.
 *
 * Distinct from the instance id, which the editor's grab frame already uses —
 * two nodes answering to one id would make `findOne` a coin toss.
 */
export const attackGroupId = (instanceId: string) => `attack:${instanceId}`;

/**
 * What could not come along when a selection was saved as an attack, so the
 * dialog can say which (plan §19.3).
 */
export interface SelectionLeftBehind {
  /**
   * Collision targets dropped, by name: they name *plan* objects, and a
   * definition cannot refer to one except through a parameter the plan answers
   * (§18.4). Nothing is silently rewired — the author is told, so they can
   * declare one.
   *
   * The only thing that *can* be left behind. An object reference out of the
   * selection becomes a placeholder instead, and an animation belonging to an
   * object you didn't select was never part of this attack to begin with.
   */
  collideWith: string[];
}

/**
 * Turn part of a plan into a definition: the objects you selected, the slide
 * state they are in, and the animations that belong to them (plan §19.3).
 *
 * **This is what §18.1's groups were for.** You have already dragged four
 * circles into a cone and animated them; that *is* an attack, and the work is
 * done by the time the author asks for it. So this reads the assembly rather
 * than making the author redraw it.
 *
 * A reference **out of** the selection becomes a {@link attackSlots placeholder}
 * — a hole the using plan fills (§18.14). That is the honest translation: a
 * tether to the boss cannot come along, because the boss is not part of what is
 * being saved, but "one end of this is something you'll nominate" is exactly
 * what a placeholder says. One placeholder per distinct outside object, named
 * after it, so `follow: { pin: boss, aim: tank }` arrives as two named slots.
 *
 * Returned as a designer {@link Plan} rather than an {@link AttackContent}, so
 * the caller pipes it through {@link planToAttackContent} and unit space is
 * still entered in exactly one place.
 */
export function selectionToAttackPlan(
  plan: Plan,
  selectedIds: readonly string[],
  slideIndex: number,
): { plan: Plan; leftBehind: SelectionLeftBehind } {
  const slide = plan.slides[slideIndex];
  const chosen = new Set(selectedIds);
  // Document order, not selection order: an attack's parts keep the stacking
  // they were drawn in, which is what `expandInstance` preserves downstream.
  const objects = plan.objects.filter((o) => chosen.has(o.id));
  const inside = new Set(objects.map((o) => o.id));

  // One placeholder per distinct outside object, minted on demand and reused,
  // so two references to the boss are one hole rather than two.
  const holes = new Map<string, PlanObject>();
  const holeFor = (id: string): string => {
    const existing = holes.get(id);
    if (existing) return existing.id;
    const target = plan.objects.find((o) => o.id === id);
    const state = slide?.states[id];
    const hole: PlanObject = {
      id: `slot-${holes.size + 1}`,
      type: "placeholder",
      base: {
        ...(target?.base ?? { z: 0 }),
        ...(state ?? {}),
        // Named for what it stood for, because "which token is this aimed at"
        // is a decision the planner revisits (§18.14).
        name: target?.base.name ?? target?.base.label ?? "Slot",
        label: "slot",
      } as ObjectBase,
    };
    holes.set(id, hole);
    return hole.id;
  };
  /** An id as the definition should say it: itself inside, a hole outside. */
  const resolve = (id: string): string => (inside.has(id) ? id : holeFor(id));

  const parts: PlanObject[] = objects.map((o) => ({
    ...o,
    // A part of an attack is not a member of the plan's group any more; the
    // instance's own id groups it once placed (`expandInstance`).
    groupId: undefined,
    ...(o.fromId ? { fromId: resolve(o.fromId) } : {}),
    ...(o.toId ? { toId: resolve(o.toId) } : {}),
    ...(isFollowing(o.follow)
      ? { follow: resolveFollow(o.follow, resolve) }
      : {}),
  }));

  const leftBehind: SelectionLeftBehind = { collideWith: [] };
  const animations: Anim[] = [];
  for (const anim of slide?.animations ?? []) {
    if (!inside.has(anim.objectId)) continue;
    const outside = (anim.collideWith ?? []).filter((id) => !inside.has(id));
    for (const id of outside) {
      const target = plan.objects.find((o) => o.id === id);
      leftBehind.collideWith.push(target?.base.name ?? id);
    }
    animations.push({
      ...anim,
      ...(anim.collideWith
        ? { collideWith: anim.collideWith.filter((id) => inside.has(id)) }
        : {}),
    });
  }
  // Placeholders last: they are holes, not artwork, and `attackContentBox`
  // ignores them anyway (§18.14).
  const all = [...parts, ...holes.values()];
  const states: Record<string, SlideState> = {};
  for (const o of all) states[o.id] = slide?.states[o.id] ?? seedState(o);

  return {
    leftBehind,
    plan: {
      ...plan,
      objects: all,
      attacks: [],
      groups: {},
      slides: [
        // Start and end are the same layout: a plan's animations already state
        // their own targets (see `AnimParamsSchema`), so there is no settled
        // state to recover — nothing is lost by the two agreeing.
        {
          id: ATTACK_START_SLIDE,
          name: "Start",
          states,
          animations: [],
        },
        { id: ATTACK_END_SLIDE, name: "End", states, animations },
      ],
    },
  };
}

/**
 * A placed attack's parts, in the state a renderer should draw them **at rest**
 * (plan §18.3).
 *
 * Distinct from {@link expandPlan}, and the difference is the whole point.
 * `expandPlan` prepares a plan for *playback*: every part opens hidden, because
 * a slide states where things start and an attack starts un-fired, and the
 * animations are what bring it on. A canvas that is not playing has no
 * animations to run, so reading a stored slide there draws nothing at all —
 * which is why the editor preview needs its own answer rather than slide 0 of
 * an expansion.
 *
 * The answer is the def's own slide: where its parts settle, which is what the
 * designer's End slide shows and what the attack *is*. Visible unless the author
 * meant otherwise — a part authored hidden that has an entrance arrives during
 * the attack, so it belongs in the picture; one hidden with no entrance was put
 * away on purpose.
 */
export function attackPartsAtRest(
  def: AttackDef,
  instance: AttackInstance,
): { object: PlanObject; state: SlideState }[] {
  const { objects, settled } = expandInstance(def, instance);
  return objects.map((object) => ({
    object,
    state: settled[object.id] ?? { ...seedState(object), visible: true },
  }));
}
