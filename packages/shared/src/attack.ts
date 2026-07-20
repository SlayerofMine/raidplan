import { z } from "zod";
import { PointSchema, type Point } from "./transform.js";
import {
  AnimSchema,
  PlanObjectSchema,
  type Anim,
  type AnimParams,
  type AttackInstance,
  type ObjectBase,
  type Plan,
  type PlanObject,
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
  animations: z.array(AnimSchema),
});
export type AttackDef = z.infer<typeof AttackDefSchema>;

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
): { objects: PlanObject[]; animations: Anim[] } {
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

  return { objects, animations };
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
        here.overrides[object.id] = {
          ...here.overrides[object.id],
          visible: true,
        };
        if (after) after.overrides[object.id] = { visible: false };
      }
      here.animations.push(...expanded.animations);
    }
  });

  return { ...plan, objects, steps };
}
