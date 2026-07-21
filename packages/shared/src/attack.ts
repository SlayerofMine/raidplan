import { z } from "zod";
import { type Point } from "./transform.js";
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
 * **Auto-follow:** an instance resolves to the *current* def by `attackId`, so
 * fixing a def improves every plan using it. (`version` is kept for a future
 * "this attack changed" marker and opt-in pinning.)
 *
 * A def is exactly a **base state plus one step** (§18.2) — objects are the start,
 * `overrides` the settled end, `animations` the transition.
 */
export const AttackDefSchema = z.object({
  id: z.string().min(1),
  encounterId: z.string().min(1),
  name: z.string().min(1),
  /** Bumped on every edit; drives auto-follow's future "changed" marker. */
  version: z.number().int().positive().default(1),
  /**
   * The rectangle a fresh instance gets, in plan pixels. Purely a **placement
   * hint** so a long beam doesn't arrive square — it is not a coordinate space,
   * and the planner resizes freely afterwards.
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
  for (const step of plan.steps) {
    for (const instance of step.attacks ?? []) ids.add(instance.attackId);
  }
  return [...ids];
}

/** Where an instance puts unit space: a centre, half-extents, and a rotation. */
interface Placement {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  rotation: number;
}

function placementOf(instance: AttackInstance): Placement {
  return {
    cx: instance.x + instance.w / 2,
    cy: instance.y + instance.h / 2,
    hx: instance.w / 2,
    hy: instance.h / 2,
    rotation: instance.rotation,
  };
}

/**
 * Map a unit point into the plan: scale by the rectangle's half-extents, then
 * rotate clockwise about its centre (Konva's y-down convention).
 */
function placePoint(u: Point, t: Placement): Point {
  const dx = u.x * t.hx;
  const dy = u.y * t.hy;
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: t.cx + dx * cos - dy * sin,
    y: t.cy + dx * sin + dy * cos,
  };
}

/** Namespaced id so two instances of the same def never collide. */
const scopedId = (instanceId: string, localId: string) =>
  `${instanceId}::${localId}`;

/** Place an object's base transform, hidden until its step reveals it. */
function placeBase(base: ObjectBase, t: Placement): ObjectBase {
  const p = placePoint({ x: base.x, y: base.y }, t);
  return {
    ...base,
    x: p.x,
    y: p.y,
    w: base.w * t.hx,
    h: base.h * t.hy,
    rotation: base.rotation + t.rotation,
    // Materialised hidden; expandPlan reveals it only on the instance's step.
    visible: false,
  };
}

/** Transform a step override's spatial fields (its end-state position/size). */
function placeOverride(ov: StepOverride, t: Placement): StepOverride {
  const out: StepOverride = { ...ov };
  if (ov.x !== undefined && ov.y !== undefined) {
    const p = placePoint({ x: ov.x, y: ov.y }, t);
    out.x = p.x;
    out.y = p.y;
  }
  if (ov.w !== undefined) out.w = ov.w * t.hx;
  if (ov.h !== undefined) out.h = ov.h * t.hy;
  if (ov.rotation !== undefined) out.rotation = ov.rotation + t.rotation;
  return out;
}

/** Transform an animation's spatial params (motion targets and paths). */
function placeParams(params: AnimParams, t: Placement): AnimParams {
  const next: AnimParams = { ...params };
  if (params.toX !== undefined && params.toY !== undefined) {
    const p = placePoint({ x: params.toX, y: params.toY }, t);
    next.toX = p.x;
    next.toY = p.y;
  }
  if (params.path) next.path = params.path.map((pt) => placePoint(pt, t));
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
  const t = placementOf(instance);

  const objects = def.objects.map((o) => ({
    ...o,
    id: scopedId(instance.id, o.id),
    ...(o.fromId ? { fromId: scopedId(instance.id, o.fromId) } : {}),
    ...(o.toId ? { toId: scopedId(instance.id, o.toId) } : {}),
    base: placeBase(o.base, t),
  }));

  const animations = def.animations.map((a) => ({
    ...a,
    id: scopedId(instance.id, a.id),
    objectId: scopedId(instance.id, a.objectId),
    ...(a.collideWith
      ? { collideWith: a.collideWith.map((id) => scopedId(instance.id, id)) }
      : {}),
    // The instance's start offset shifts the whole attack within its step.
    delayMs: a.delayMs + instance.startMs,
    ...(a.params ? { params: placeParams(a.params, t) } : {}),
  }));

  const overrides: Record<string, StepOverride> = {};
  for (const [localId, ov] of Object.entries(def.overrides)) {
    overrides[scopedId(instance.id, localId)] = placeOverride(ov, t);
  }

  return { objects, animations, overrides };
}

/**
 * Expand every attack instance in `plan` into concrete objects and animations,
 * returning an ordinary {@link Plan} that any renderer already understands.
 *
 * Each attack's objects exist **only during their step**: hidden before (base
 * `visible: false`), shown by a `visible: true` override on the step, and hidden
 * again on the next one. The def's own animations play on top of that.
 *
 * Pure and non-mutating. An instance whose `attackId` isn't in `defsById` is
 * skipped — a missing def leaves the rest of the plan renderable, like a missing
 * background. A plan with no attacks is returned untouched, so the common case
 * costs nothing.
 */
export function expandPlan(
  plan: Plan,
  defsById: Record<string, AttackDef>,
): Plan {
  if (!plan.steps.some((s) => s.attacks && s.attacks.length > 0)) return plan;

  const objects: PlanObject[] = [...plan.objects];
  const steps = plan.steps.map((s) => ({
    ...s,
    overrides: { ...s.overrides },
    animations: [...s.animations],
    attacks: [],
  }));

  plan.steps.forEach((step, stepIndex) => {
    for (const instance of step.attacks ?? []) {
      const def = defsById[instance.attackId];
      if (!def) continue;

      const expanded = expandInstance(def, instance);
      objects.push(...expanded.objects);

      const here = steps[stepIndex]!;
      const after = steps[stepIndex + 1];
      for (const object of expanded.objects) {
        // The def's placed end state, made present on its step (unless the def
        // explicitly ends it hidden, e.g. a disappear).
        const end = expanded.overrides[object.id] ?? {};
        here.overrides[object.id] = { ...end, visible: end.visible ?? true };
        if (after) after.overrides[object.id] = { visible: false };
      }
      here.animations.push(...expanded.animations);
    }
  });

  return { ...plan, objects, steps };
}

/**
 * The synthetic background an attack is authored on: a plain square the size of
 * {@link ATTACK_AUTHORING_SIZE}. `getBackgroundSrc` doesn't recognise it, so it
 * renders as an empty floor — the designer draws on a blank grid, not a map.
 */
export const ATTACK_BOX_ASSET = "attack-box";

/**
 * The designer's canvas, in pixels, standing in for unit space.
 *
 * The editor works in pixels everywhere — drag, snapping, the properties panel —
 * so the designer authors on this square and the conversions below are the only
 * place unit space is entered or left. Storage and expansion stay unit-only.
 */
export const ATTACK_AUTHORING_SIZE = 1000;

/** Authoring pixels → unit space (-1..1) for a position along one axis. */
const toUnit = (px: number, size: number) => (px - size / 2) / (size / 2);
/** Authoring pixels → unit space for a *length* (2 spans the rectangle). */
const toUnitLength = (px: number, size: number) => px / (size / 2);
const fromUnit = (u: number, size: number) => size / 2 + u * (size / 2);
const fromUnitLength = (u: number, size: number) => u * (size / 2);

/** Convert one object's transform between unit space and authoring pixels. */
function convertBase(
  base: ObjectBase,
  size: number,
  toPixels: boolean,
): ObjectBase {
  const pos = toPixels ? fromUnit : toUnit;
  const len = toPixels ? fromUnitLength : toUnitLength;
  return {
    ...base,
    x: pos(base.x, size),
    y: pos(base.y, size),
    w: len(base.w, size),
    h: len(base.h, size),
  };
}

function convertOverride(
  ov: StepOverride,
  size: number,
  toPixels: boolean,
): StepOverride {
  const pos = toPixels ? fromUnit : toUnit;
  const len = toPixels ? fromUnitLength : toUnitLength;
  const out: StepOverride = { ...ov };
  if (ov.x !== undefined) out.x = pos(ov.x, size);
  if (ov.y !== undefined) out.y = pos(ov.y, size);
  if (ov.w !== undefined) out.w = len(ov.w, size);
  if (ov.h !== undefined) out.h = len(ov.h, size);
  return out;
}

function convertParams(
  params: AnimParams,
  size: number,
  toPixels: boolean,
): AnimParams {
  const pos = toPixels ? fromUnit : toUnit;
  const out: AnimParams = { ...params };
  if (params.toX !== undefined) out.toX = pos(params.toX, size);
  if (params.toY !== undefined) out.toY = pos(params.toY, size);
  if (params.path) {
    out.path = params.path.map((p) => ({
      x: pos(p.x, size),
      y: pos(p.y, size),
    }));
  }
  return out;
}

const convertAnim = (a: Anim, size: number, toPixels: boolean): Anim => ({
  ...a,
  ...(a.params ? { params: convertParams(a.params, size, toPixels) } : {}),
});

/**
 * Present an {@link AttackDef} as a one-step {@link Plan} the editor store can
 * load, so the attack designer *is* the editor (plan §17 stage 4 / §18.2). The
 * def's unit-space content is scaled onto the authoring canvas on the way in.
 */
export function defToPlan(def: AttackDef): Plan {
  const size = ATTACK_AUTHORING_SIZE;
  const overrides: Record<string, StepOverride> = {};
  for (const [id, ov] of Object.entries(def.overrides)) {
    overrides[id] = convertOverride(ov, size, true);
  }
  return {
    id: def.id,
    title: def.name,
    raid: "",
    background: { assetId: ATTACK_BOX_ASSET, width: size, height: size },
    objects: def.objects.map((o) => ({
      ...o,
      base: convertBase(o.base, size, true),
    })),
    steps: [
      {
        id: "attack",
        overrides,
        animations: def.animations.map((a) => convertAnim(a, size, true)),
      },
    ],
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * Extract an attack's editable body back out of the designer's plan, normalising
 * it to unit space. The inverse of {@link defToPlan}.
 */
export function planToAttackContent(
  plan: Plan,
  meta: { name: string; defaultSize: { w: number; h: number } },
): AttackContent {
  const size = plan.background.width;
  const step = plan.steps[0];
  const overrides: Record<string, StepOverride> = {};
  for (const [id, ov] of Object.entries(step?.overrides ?? {})) {
    overrides[id] = convertOverride(ov, size, false);
  }
  return {
    name: meta.name,
    defaultSize: meta.defaultSize,
    objects: plan.objects.map((o) => ({
      ...o,
      base: convertBase(o.base, size, false),
    })),
    overrides,
    animations: (step?.animations ?? []).map((a) =>
      convertAnim(a, size, false),
    ),
  };
}
