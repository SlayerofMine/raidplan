import { z } from "zod";
import { PointSchema, type Point } from "./transform.js";
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
 * Reusable attacks (plan §17, stage 3) — the reference/instance model.
 *
 * An **AttackDef** is a small, self-contained bundle of objects and animations
 * authored once (the admin's attack designer). A plan never stores those
 * internals; it stores an {@link AttackInstance} — an id and a transform — and
 * {@link expandPlan} stamps the def in at render time. So the same three
 * renderers that draw a plan (Konva, the OG SVG, the WebM export) draw attacks
 * for free, and an attack is indivisible because its parts aren't in the
 * document to begin with.
 *
 * **Auto-follow:** an instance resolves to the *current* def by `attackId`, so
 * fixing a def improves every plan that uses it. (A `version` is kept for a
 * future "this attack changed" marker and opt-in pinning.)
 *
 * v1 effect vocabulary for a def's animations is the params-driven set —
 * `appear`, `disappear`, `move` (via `params.toX/toY`/`path`), `fade` (via
 * `params.toOpacity`), `pulse`, `blink`. `scale`/`fly` want a per-object end
 * state, which a def doesn't carry yet; that's a documented follow-up.
 */
export const AttackDefSchema = z.object({
  id: z.string().min(1),
  encounterId: z.string().min(1),
  name: z.string().min(1),
  /** Bumped on every edit; drives auto-follow's future "changed" marker. */
  version: z.number().int().positive().default(1),
  /** The authoring canvas size, in the def's own pixel space. */
  box: z.object({
    w: z.number().finite().positive(),
    h: z.number().finite().positive(),
  }),
  /** The grab point in def space; an instance's position places *this* point. */
  anchor: PointSchema,
  objects: z.array(PlanObjectSchema),
  /**
   * The attack's settled **end state**, per object (def space) — a single
   * "slide" the animations play toward, exactly like a plan step. This is what
   * lets the designer author `move`/`scale`/`fly` by dragging on the canvas, and
   * what `expandPlan` transforms into the instance's step. Optional/`{}` for an
   * attack that only pulses or blinks in place.
   */
  overrides: z.record(z.string().min(1), StepOverrideSchema).default({}),
  animations: z.array(AnimSchema),
});
export type AttackDef = z.infer<typeof AttackDefSchema>;

/** The editable body of an attack — everything but its identity and version. */
export type AttackContent = Omit<AttackDef, "id" | "encounterId" | "version">;

/**
 * The distinct attack ids a plan references, so a renderer can fetch just the
 * definitions it needs before calling {@link expandPlan}. Empty for the common
 * plan with no attacks.
 */
export function attackIdsInPlan(plan: Plan): string[] {
  const ids = new Set<string>();
  for (const step of plan.steps) {
    for (const instance of step.attacks ?? []) ids.add(instance.attackId);
  }
  return [...ids];
}

/** A placement: how an instance maps def space into the plan's space. */
interface Placement {
  anchor: Point;
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

/**
 * Map a point from def space into plan space: translate relative to the anchor,
 * scale, rotate (clockwise, matching Konva's y-down convention), then offset to
 * the instance position.
 */
function placePoint(p: Point, t: Placement): Point {
  const dx = (p.x - t.anchor.x) * t.scale;
  const dy = (p.y - t.anchor.y) * t.scale;
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: t.x + dx * cos - dy * sin,
    y: t.y + dx * sin + dy * cos,
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
    w: base.w * t.scale,
    h: base.h * t.scale,
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
  if (ov.w !== undefined) out.w = ov.w * t.scale;
  if (ov.h !== undefined) out.h = ov.h * t.scale;
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
  const t: Placement = {
    anchor: def.anchor,
    x: instance.x,
    y: instance.y,
    rotation: instance.rotation,
    scale: instance.scale,
  };

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
 * again by a `visible: false` override on the next one. The def's own animations
 * play on top of that.
 *
 * Pure and non-mutating. An instance whose `attackId` isn't in `defsById` is
 * skipped — a missing def leaves the rest of the plan renderable, like a missing
 * background. The no-attacks case returns the plan untouched, so it costs
 * nothing for the overwhelming majority of plans.
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
 * The synthetic background an attack is authored on: a plain box the size of the
 * def's canvas. `getBackgroundSrc` doesn't recognise it, so it renders as an
 * empty floor — the designer draws the attack on a blank grid, not a map.
 */
export const ATTACK_BOX_ASSET = "attack-box";

/**
 * Present an {@link AttackDef} as a one-step {@link Plan} the editor store can
 * load, so the attack designer *is* the editor (plan §17, stage 4). The def's
 * objects are the base layout, its `overrides` are the single step's end state,
 * and its animations are that step's timeline.
 */
export function defToPlan(def: AttackDef): Plan {
  return {
    id: def.id,
    title: def.name,
    raid: "",
    background: {
      assetId: ATTACK_BOX_ASSET,
      width: def.box.w,
      height: def.box.h,
    },
    objects: def.objects,
    steps: [
      { id: "attack", overrides: def.overrides, animations: def.animations },
    ],
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * Extract an attack's editable body back out of the designer's plan, combined
 * with the name and anchor the designer tracks separately. The inverse of
 * {@link defToPlan}.
 */
export function planToAttackContent(
  plan: Plan,
  meta: { name: string; anchor: Point },
): AttackContent {
  const step = plan.steps[0];
  return {
    name: meta.name,
    box: { w: plan.background.width, h: plan.background.height },
    anchor: meta.anchor,
    objects: plan.objects,
    overrides: step?.overrides ?? {},
    animations: step?.animations ?? [],
  };
}
