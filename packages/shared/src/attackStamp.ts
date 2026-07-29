import {
  attackParamValue,
  attackSlots,
  type AttackInstance,
  type AttackParam,
  type AttackParamValue,
} from "./attack.js";
import { ANIM_EFFECTS, type AnimEffect } from "./effects.js";
import { MECH_FILL_STYLES, type MechFillStyle } from "./mechanics.js";
import type { Anim, AttackDef, PlanObject, SlideState } from "./plan.js";
import { resolveFollow } from "./follow.js";
import { isDeferredTrigger } from "./timeline.js";
import { centrePoint, topLeftForCentre, type Point } from "./transform.js";
import {
  attackAnchor,
  localScale,
  transformDir,
  transformPoint,
  transformState,
} from "./attackTransform.js";

/**
 * Stamping an attack into a plan (plan §21).
 *
 * **The instance is a recipe, not a result.** `stampAttack` is the whole of the
 * derivation: definition + recipe in, ordinary objects, ordinary slide states
 * and ordinary animations out. Every edit to a placement — move it, turn it,
 * scale it, retime it, change a parameter, rebind a slot — changes the recipe
 * and runs this again *from the definition*, never from what was stamped last
 * time. That is the one invariant the feature is built on: geometry is always
 * `transform(authored)`, so ten drags of a handle produce the same document as
 * one drag to the same place, and there is nowhere for error to compound (§20).
 *
 * Ids are **stable across re-stamps**. The instance carries the map it minted,
 * and a re-derivation reuses it, so a tether the planner drew into the attack or
 * a `collideWith` naming one of its objects survives every re-stamp. Ids that
 * name nothing are pruned on load, the same repair `normalizeSlides` does.
 *
 * Order of operations, and it matters: **parameters first, in the attack's own
 * authored space, then the placement transform.** A parameter that widens a
 * puddle should still be scaled by the placement; a parameter that lengthens a
 * cast should still be stretched by `timeScale`. Doing it the other way round
 * would make "2 seconds" mean something different in every placement.
 */

/** What a caller must supply to derive a placement. */
export interface StampContext {
  def: AttackDef;
  instance: AttackInstance;
  /**
   * The plan-side slide state of each object bound to a slot. Needed because a
   * `move` stores a top-left, so aiming one at a bound token means knowing how
   * big that token is — the slot it stood in may have been a different size.
   */
  boundStates: Record<string, SlideState>;
  /** The group the stamped objects join, so they select and drag as one. */
  groupId: string;
  nextObjectId: () => string;
  nextAnimId: () => string;
}

export interface StampResult {
  /** The objects the instance owns — never the plan objects bound to its slots. */
  objects: PlanObject[];
  /** Their state on the slide the attack lives on. */
  states: Record<string, SlideState>;
  /**
   * The instance's animations, as one **contiguous block** whose first
   * non-deferred member is `onEnter`. Append them as a block: the slide's chain
   * runs in document order, so a block split apart would chain onto a stranger.
   */
  animations: Anim[];
  /** The recipe, with its id maps brought up to date. */
  instance: AttackInstance;
}

/* -------------------------------------------------------------------------- */
/* Parameters                                                                  */
/* -------------------------------------------------------------------------- */

/** The definition as the placement's parameters make it — still in authored space. */
interface Parameterised {
  objects: PlanObject[];
  states: Record<string, SlideState>;
  animations: Anim[];
  /**
   * Animations whose `collideWith` a parameter supplied. Those ids are already
   * in the **plan's** namespace — the point of exposing the field is to let the
   * planner name their own tokens — so the id remap must leave them alone.
   */
  planSpaceColliders: Set<string>;
}

const isEffect = (v: AttackParamValue): v is AnimEffect =>
  typeof v === "string" && (ANIM_EFFECTS as readonly string[]).includes(v);

const isFill = (v: AttackParamValue): v is MechFillStyle =>
  typeof v === "string" && (MECH_FILL_STYLES as readonly string[]).includes(v);

const num = (v: AttackParamValue): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * Apply the placement's parameter values to a copy of the definition.
 *
 * Each binding names a field the `ATTACK_FIELDS` table already knows, and
 * the schema has already checked that the parameter's kind matches every field
 * it drives — so nothing here has to guess, and a value that is somehow still
 * the wrong shape is skipped rather than written.
 */
function applyParams(
  def: AttackDef,
  instance: AttackInstance,
  params: readonly AttackParam[],
): Parameterised {
  const objects = def.objects.map((o) => ({
    ...o,
    base: { ...o.base },
    ...(o.style ? { style: { ...o.style } } : {}),
  }));
  const byId = new Map(objects.map((o) => [o.id, o]));
  const states: Record<string, SlideState> = Object.fromEntries(
    Object.entries(def.slide.states).map(([id, s]) => [id, { ...s }]),
  );
  const animations = def.slide.animations.map((a) => ({
    ...a,
    ...(a.params ? { params: { ...a.params } } : {}),
  }));
  const animById = new Map(animations.map((a) => [a.id, a]));
  const planSpaceColliders = new Set<string>();

  for (const param of params) {
    const value = attackParamValue(param, instance.values);
    for (const target of param.targets) {
      if (target.on === "object") {
        const object = byId.get(target.targetId);
        const state = states[target.targetId];
        switch (target.field) {
          case "tint":
            if (object && typeof value === "string") object.base.tint = value;
            break;
          case "label":
            if (object && typeof value === "string") object.base.label = value;
            break;
          case "name":
            if (object && typeof value === "string") object.base.name = value;
            break;
          case "locked":
            if (object && typeof value === "boolean") object.locked = value;
            break;
          case "fill":
            if (object && isFill(value))
              object.style = { ...object.style, fill: value };
            break;
          case "opacity": {
            const n = num(value);
            if (state && n !== undefined)
              state.opacity = Math.min(1, Math.max(0, n));
            break;
          }
          case "w": {
            const n = num(value);
            if (state && n !== undefined) state.w = Math.max(0, n);
            break;
          }
          case "h": {
            const n = num(value);
            if (state && n !== undefined) state.h = Math.max(0, n);
            break;
          }
          default:
            break;
        }
        continue;
      }

      const anim = animById.get(target.targetId);
      if (!anim) continue;
      switch (target.field) {
        case "delayMs": {
          const n = num(value);
          if (n !== undefined) anim.delayMs = Math.max(0, n);
          break;
        }
        case "durationMs": {
          const n = num(value);
          if (n !== undefined) anim.durationMs = Math.max(0, n);
          break;
        }
        case "easing":
          if (typeof value === "string" && value.length > 0)
            anim.easing = value;
          break;
        case "effect":
          if (isEffect(value)) anim.effect = value;
          break;
        case "scale": {
          const n = num(value);
          if (n !== undefined && n > 0)
            anim.params = { ...anim.params, scale: n };
          break;
        }
        case "curve": {
          const n = num(value);
          if (n !== undefined)
            anim.params = {
              ...anim.params,
              curve: Math.min(1, Math.max(0, n)),
            };
          break;
        }
        case "collideWith":
          if (Array.isArray(value)) {
            anim.collideWith = [...value];
            planSpaceColliders.add(anim.id);
          }
          break;
        default:
          break;
      }
    }
  }

  return { objects, states, animations, planSpaceColliders };
}

/* -------------------------------------------------------------------------- */
/* The stamp                                                                   */
/* -------------------------------------------------------------------------- */

/** Milliseconds are whole in the document; scaling them must not drift into fractions. */
const scaleMs = (ms: number, factor: number): number =>
  Math.max(0, Math.round(ms * factor));

export function stampAttack(ctx: StampContext): StampResult {
  const { def, instance, boundStates, groupId } = ctx;
  const { objects, states, animations, planSpaceColliders } = applyParams(
    def,
    instance,
    def.params,
  );

  const slotIds = new Set(attackSlots(objects).map((o) => o.id));
  const anchor = attackAnchor(states);

  // --- ids ---------------------------------------------------------------
  // Reused from the instance's own map wherever it has one, so a re-stamp
  // produces the same ids and nothing outside the attack loses its reference.
  const objectMap: Record<string, string> = {};
  const animMap: Record<string, string> = {};

  /** A definition id, in the plan's namespace — or `undefined` if it has none. */
  const resolveId = (defId: string): string | undefined => {
    if (slotIds.has(defId)) return instance.slots[defId];
    if (objectMap[defId]) return objectMap[defId];
    if (!states[defId]) return undefined; // not in the attack's own scene
    const id = instance.objectMap[defId] ?? ctx.nextObjectId();
    objectMap[defId] = id;
    return id;
  };

  // Minted in definition order, so re-stamping an unchanged definition mints
  // nothing and the map stays exactly as it was.
  for (const object of objects) {
    if (!slotIds.has(object.id)) resolveId(object.id);
  }

  // --- objects and their states ------------------------------------------
  const outObjects: PlanObject[] = [];
  const outStates: Record<string, SlideState> = {};

  /** The state a stamped or bound object ends up in, for the geometry below. */
  const stateOf = (planId: string): SlideState | undefined =>
    outStates[planId] ?? boundStates[planId];

  for (const object of objects) {
    if (slotIds.has(object.id)) continue;
    const id = objectMap[object.id];
    const authored = states[object.id];
    if (!id || !authored) continue;

    const placed = transformState(authored, anchor, instance.transform);
    outStates[id] = placed;

    const local = localScale(
      authored.rotation,
      instance.transform.sx,
      instance.transform.sy,
    );
    const dir = transformDir(object.base.dir, local);
    const from = object.fromId ? resolveId(object.fromId) : undefined;
    const to = object.toId ? resolveId(object.toId) : undefined;

    // A slot never reaches a plan, so nothing that arrives in one can still
    // claim to be one — `slotName` on a plan object would be a lie the designer
    // would later believe.
    const { slotName: _slot, ...rest } = object;

    outObjects.push({
      ...rest,
      id,
      groupId,
      attackId: instance.id,
      ...(object.fromId ? { fromId: from ?? object.fromId } : {}),
      ...(object.toId ? { toId: to ?? object.toId } : {}),
      ...(object.follow
        ? { follow: resolveFollow(object.follow, (i) => resolveId(i) ?? i) }
        : {}),
      base: {
        ...object.base,
        // The seed is stale by design (plan §5), but leaving it in the attack's
        // authored space would hand a wrong answer to anything that reads it.
        x: placed.x,
        y: placed.y,
        w: placed.w,
        h: placed.h,
        rotation: placed.rotation,
        opacity: placed.opacity,
        visible: placed.visible,
        ...(dir !== undefined ? { dir } : {}),
      },
    });
  }

  // --- animations ---------------------------------------------------------
  const outAnimations: Anim[] = [];
  let anchored = false;

  for (const anim of animations) {
    const objectId = resolveId(anim.objectId);
    if (!objectId) continue;
    const id = instance.animMap[anim.id] ?? ctx.nextAnimId();
    animMap[anim.id] = id;

    const deferred = isDeferredTrigger(anim.trigger);
    // The block must *start* absolutely, or it would chain onto whatever the
    // planner happened to author before it. Everything after keeps the timing
    // the author gave it, relative to that start.
    let trigger = anim.trigger;
    if (!deferred && !anchored) {
      trigger = "onEnter";
      anchored = true;
    }
    const delayMs = scaleMs(anim.delayMs, instance.timeScale);

    outAnimations.push({
      ...anim,
      id,
      objectId,
      trigger,
      // Every absolute anchor in the block moves with the attack; the relative
      // ones are already carried by the animation they chain onto.
      delayMs:
        trigger === "onEnter" ? instance.anchorDelayMs + delayMs : delayMs,
      durationMs: scaleMs(anim.durationMs, instance.timeScale),
      ...(anim.collideWith
        ? {
            collideWith: planSpaceColliders.has(anim.id)
              ? [...anim.collideWith]
              : anim.collideWith
                  .map((cid) => resolveId(cid))
                  .filter((cid): cid is string => cid !== undefined),
          }
        : {}),
      ...(anim.params
        ? {
            params: placeParams(
              anim.params,
              states[anim.objectId],
              stateOf(objectId),
              anchor,
              instance,
            ),
          }
        : {}),
    });
  }

  return {
    objects: outObjects,
    states: outStates,
    animations: outAnimations,
    instance: { ...instance, objectMap, animMap },
  };
}

/**
 * An animation's tunable geometry, moved with the attack.
 *
 * `path` waypoints are centres and move bodily. `toX`/`toY` is a **top-left**,
 * so it is converted to the centre it stands for using the box it was authored
 * against, transformed, and converted back using the box it will actually
 * belong to — which is a different box whenever the animation ended up on an
 * object bound to a slot. Doing it in centre space is the whole trick: rotation
 * is about the corner, so translating the stored corner would swing the
 * destination off its mark.
 */
function placeParams(
  params: NonNullable<Anim["params"]>,
  authored: SlideState | undefined,
  target: SlideState | undefined,
  anchor: Point,
  instance: AttackInstance,
): NonNullable<Anim["params"]> {
  const out = { ...params };

  if (params.path) {
    out.path = params.path.map((p) =>
      transformPoint(p, anchor, instance.transform),
    );
  }

  if (
    params.toX !== undefined &&
    params.toY !== undefined &&
    authored &&
    target
  ) {
    const centre = centrePoint({
      x: params.toX,
      y: params.toY,
      w: authored.w,
      h: authored.h,
      rotation: authored.rotation,
    });
    const moved = transformPoint(centre, anchor, instance.transform);
    const corner = topLeftForCentre(
      { x: 0, y: 0, w: target.w, h: target.h, rotation: target.rotation },
      moved,
    );
    out.toX = corner.x;
    out.toY = corner.y;
  }

  return out;
}
