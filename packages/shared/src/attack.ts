import { z } from "zod";
import { type Point } from "./transform.js";
import { isDeferredTrigger, layoutStepTimeline } from "./timeline.js";
import {
  AnimSchema,
  PlanObjectSchema,
  SCHEMA_VERSION,
  StepOverrideSchema,
  type Anim,
  type AnimParams,
  type AttackInstance,
  type ObjectBase,
  type Plan,
  type PlanObject,
  type StepOverride,
} from "./plan.js";

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
 * A def is exactly a **base state plus one step** (§18.2) — objects are the start,
 * `overrides` the settled end, `animations` the transition.
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

export const AttackDefSchema = z.object({
  id: z.string().min(1),
  encounterId: z.string().min(1),
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
  /** Start state, in unit space. */
  objects: z.array(PlanObjectSchema),
  /** Settled end state, in unit space (the def's single step). */
  overrides: z.record(z.string().min(1), StepOverrideSchema).default({}),
  animations: z.array(AnimSchema),
  /** What a plan must (or may) tell this attack (plan §18.4). */
  params: z.array(AttackParamSchema).default([]),
  /** Which internals read which parameter. */
  bindings: AttackBindingsSchema,
});
export type AttackDef = z.infer<typeof AttackDefSchema>;

/** The editable body of an attack — everything but its identity and version. */
export type AttackContent = Omit<AttackDef, "id" | "encounterId" | "version">;

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
  return layoutStepTimeline(def.animations).totalMs;
}

/** How long a *placed* attack runs: its own duration if stretched, else the def's. */
export function attackSpanMs(def: AttackDef, instance: AttackInstance): number {
  return instance.durationMs ?? attackNaturalMs(def);
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

/**
 * Everything an attack covers **over its whole life**: where its parts start,
 * where they settle, and everywhere a motion carries them in between.
 *
 * This box *is* the attack, and it's what an instance's rectangle is mapped onto
 * — so the frame a planner grabs hugs the artwork instead of floating around it.
 * Returns `null` for an attack with nothing in it.
 *
 * Tethers are skipped: their geometry comes from their endpoints, so their own
 * transform is degenerate and would drag the box to the origin.
 */
export function attackContentBox(content: {
  objects: PlanObject[];
  overrides: Record<string, StepOverride>;
  animations: Anim[];
}): AttackBox | null {
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

  for (const o of content.objects) {
    if (o.type === "tether") continue;
    const base = o.base;
    const end = { ...base, ...content.overrides[o.id] };
    for (const corner of cornersOf(base)) add(corner);
    for (const corner of cornersOf(end)) add(corner);

    for (const anim of content.animations) {
      if (anim.objectId !== o.id || !anim.params) continue;
      const { toX, toY, path } = anim.params;
      // A motion target is a *position* for the object, so the whole footprint
      // travels there.
      if (toX !== undefined && toY !== undefined) {
        for (const corner of cornersOf({ ...base, x: toX, y: toY }))
          add(corner);
      }
      for (const point of path ?? []) {
        for (const corner of cornersOf({ ...base, x: point.x, y: point.y })) {
          add(corner);
        }
      }
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
 * Objects an entrance effect brings on screen during the attack. They're
 * authored hidden (or become hidden when materialised) and the animation is what
 * reveals them, so their settled state must be *visible* even though their base
 * isn't.
 */
function entranceTargets(def: AttackDef): Set<string> {
  const ids = new Set<string>();
  for (const anim of def.animations) {
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
 * Move a step override's spatial fields (its end-state position/size).
 *
 * A missing coordinate is filled in from `base`, because a rotated placement
 * mixes the axes: "ends 30 to the right" can't be expressed as an x alone once
 * the attack is turned, so both come out together or neither does.
 */
function mapOverride(
  ov: StepOverride,
  base: ObjectBase | undefined,
  from: AttackBox,
  to: AttackBox,
  rotation = 0,
): StepOverride {
  const out: StepOverride = { ...ov };
  const x = ov.x ?? base?.x;
  const y = ov.y ?? base?.y;
  if (x !== undefined && y !== undefined) {
    const p = mapPoint({ x, y }, from, to, rotation);
    out.x = p.x;
    out.y = p.y;
  }
  if (ov.w !== undefined) out.w = (ov.w / from.hx) * to.hx;
  if (ov.h !== undefined) out.h = (ov.h / from.hy) * to.hy;
  if (ov.rotation !== undefined) out.rotation = ov.rotation + rotation;
  return out;
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
  overrides: Record<string, StepOverride>;
} {
  // The def's own extent is mapped onto the instance's rectangle, so the frame
  // hugs the attack whatever coordinates it happens to be authored in.
  const from = defBox(def);
  const to = instanceBox(instance);
  const spin = instance.rotation;
  const entrances = entranceTargets(def);

  /** An argument the plan supplied, else the parameter's declared default. */
  const argOf = (key: string): AttackParamValue | undefined =>
    instance.args[key] ?? def.params.find((p) => p.key === key)?.default;

  // The attack occupies one place in the board's stack; its parts share it,
  // separated by a hair so the definition's own order survives the sort.
  const baseZ = attackZ(instance);
  const objects = def.objects.map((o, index) => {
    const tint = argOf(def.bindings.tint[o.id] ?? "");
    const placed = {
      ...mapBase(o.base, from, to, spin),
      z: baseZ + index * Number.EPSILON,
      // Materialised hidden; the attack's step is what reveals it.
      visible: false,
    };
    return {
      ...o,
      id: scopedId(instance.id, o.id),
      ...(o.fromId ? { fromId: scopedId(instance.id, o.fromId) } : {}),
      ...(o.toId ? { toId: scopedId(instance.id, o.toId) } : {}),
      base: typeof tint === "string" ? { ...placed, tint } : placed,
    };
  });

  // A parameter can change when a part runs and for how long, so bound timings
  // are settled first — the chain below lays out against the result.
  const effective: Anim[] = def.animations.map((a) => {
    const duration = argOf(def.bindings.durationMs[a.id] ?? "");
    const delay = argOf(def.bindings.delayMs[a.id] ?? "");
    return {
      ...a,
      ...(typeof duration === "number" ? { durationMs: duration } : {}),
      ...(typeof delay === "number" ? { delayMs: delay } : {}),
    };
  });

  // Resolve the def's own trigger chain *before* it joins the host step, using
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
      : a.collideWith?.map((id) => scopedId(instance.id, id));

    return {
      ...a,
      id: scopedId(instance.id, a.id),
      objectId: scopedId(instance.id, a.objectId),
      ...(collideWith ? { collideWith } : {}),
      durationMs: a.durationMs * stretch,
      // A deferred animation is timed from the event that fires it (a click, a
      // collision), not from the step, so it keeps its own delay — stretched
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

  // An attack's parts are materialised hidden so they can't show on the steps
  // around it, which leaves the author on the hook for an entrance on every
  // single one. Give the ones that have none an implicit `appear` when the
  // attack fires — otherwise the attack plays out invisibly (the step's end
  // state alone can't reveal it, because nothing tweens `visible`).
  for (const o of def.objects) {
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

  const overrides: Record<string, StepOverride> = {};
  for (const o of def.objects) {
    const id = scopedId(instance.id, o.id);
    const end = def.overrides[o.id];
    // The settled state: the def's placed end state, present unless the def
    // says otherwise — an object the author left hidden and never brings on
    // stays hidden.
    overrides[id] = {
      ...(end ? mapOverride(end, o.base, from, to, spin) : {}),
      visible: end?.visible ?? (o.base.visible || entrances.has(o.id)),
    };
  }

  return { objects, animations, overrides };
}

/**
 * Expand every attack instance in `plan` into concrete objects and animations,
 * returning an ordinary {@link Plan} that any renderer already understands.
 *
 * Each attack's objects exist **only during their step**: hidden before (base
 * `visible: false`), shown by a `visible: true` override on the step, and hidden
 * again on the next one. That override is the *settled* state, which is what a
 * renderer draws when the step is parked — but nothing tweens `visible`, so
 * mid-playback an attack is revealed by an entrance effect instead: the def's
 * own, or an implicit `appear` at the instant the attack fires.
 *
 * The def's animations are flattened onto absolute delays on the way in, so an
 * attack keeps its own timing no matter what else shares the step.
 *
 * Pure and non-mutating. An instance that is switched off, or whose `attackId`
 * isn't in `defsById`, or whose step has been deleted, is skipped — either leaves the rest of the plan
 * renderable, like a missing background. A plan with no attacks is returned
 * untouched, so the common case costs nothing.
 */
export function expandPlan(
  plan: Plan,
  defsById: Record<string, AttackDef>,
): Plan {
  if (plan.attacks.length === 0) return plan;

  const objects: PlanObject[] = [...plan.objects];
  const steps = plan.steps.map((s) => ({
    ...s,
    overrides: { ...s.overrides },
    animations: [...s.animations],
  }));
  const indexOfStep = new Map(plan.steps.map((s, i) => [s.id, i]));

  for (const instance of plan.attacks) {
    const def = defsById[instance.attackId];
    const stepIndex = indexOfStep.get(instance.stepId);
    // A missing def or a step that's been deleted leaves the rest of the plan
    // renderable, like a missing background. A switched-off attack simply
    // doesn't happen: it stays in the document, and out of the expansion.
    if (!def || stepIndex === undefined || instance.visible === false) continue;

    const expanded = expandInstance(def, instance);
    objects.push(...expanded.objects);

    const here = steps[stepIndex]!;
    const after = steps[stepIndex + 1];
    for (const object of expanded.objects) {
      // The def's settled state lands on the attack's step; the next step
      // takes it away again, so an attack is over when the step is.
      here.overrides[object.id] = expanded.overrides[object.id] ?? {};
      if (after) after.overrides[object.id] = { visible: false };
    }
    here.animations.push(...expanded.animations);
  }

  // Draw order is `base.z`, and a renderer walks the array — so the array has to
  // be in z order for an attack to sit under the token standing on it. Stable,
  // so objects and an attack's own parts keep the order they were given.
  objects.sort((a, b) => a.base.z - b.base.z);
  return { ...plan, objects, steps, attacks: [] };
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

/**
 * Present an {@link AttackDef} as a one-step {@link Plan} the editor store can
 * load, so the attack designer *is* the editor (plan §17 stage 4 / §18.2).
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

  const baseById = new Map(def.objects.map((o) => [o.id, o.base]));
  const overrides: Record<string, StepOverride> = {};
  for (const [id, ov] of Object.entries(def.overrides)) {
    overrides[id] = mapOverride(ov, baseById.get(id), from, to);
  }
  return {
    id: def.id,
    title: def.name,
    raid: "",
    background: { assetId: ATTACK_BOX_ASSET, width: size, height: size },
    objects: def.objects.map((o) => ({
      ...o,
      base: mapBase(o.base, from, to),
    })),
    attacks: [],
    steps: [
      {
        id: "attack",
        overrides,
        animations: def.animations.map((a) => mapAnim(a, from, to)),
      },
    ],
    schemaVersion: SCHEMA_VERSION,
  };
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
  },
): AttackContent {
  const step = plan.steps[0];
  const content = {
    objects: plan.objects,
    overrides: step?.overrides ?? {},
    animations: step?.animations ?? [],
  };
  const from = attackContentBox(content);
  const defaultSize = from
    ? { w: from.hx * 2, h: from.hy * 2 }
    : { w: 400, h: 400 };

  const baseById = new Map(content.objects.map((o) => [o.id, o.base]));
  const overrides: Record<string, StepOverride> = {};
  for (const [id, ov] of Object.entries(content.overrides)) {
    overrides[id] = mapOverride(
      ov,
      baseById.get(id),
      from ?? UNIT_BOX,
      UNIT_BOX,
    );
  }
  return {
    name: meta.name,
    defaultSize,
    objects: content.objects.map((o) => ({
      ...o,
      base: mapBase(o.base, from ?? UNIT_BOX, UNIT_BOX),
    })),
    overrides,
    animations: content.animations.map((a) =>
      mapAnim(a, from ?? UNIT_BOX, UNIT_BOX),
    ),
    // Parameters and their bindings aren't spatial, so they pass straight
    // through from the designer rather than round-tripping via the canvas.
    params: meta.params ?? [],
    bindings: meta.bindings ?? {
      collideWith: {},
      durationMs: {},
      delayMs: {},
      tint: {},
    },
  };
}
