import { beforeEach, describe, expect, it } from "vitest";
import {
  IDENTITY_ATTACK_TRANSFORM,
  type AttackInstance,
  type AttackParam,
  type AttackTransform,
} from "../src/attack.js";
import { stampAttack, type StampContext } from "../src/attackStamp.js";
import { layoutStepTimeline } from "../src/timeline.js";
import type { Anim, AttackDef, PlanObject, SlideState } from "../src/plan.js";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const state = (over: Partial<SlideState> = {}): SlideState => ({
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  opacity: 1,
  visible: true,
  ...over,
});

function object(id: string, over: Partial<PlanObject> = {}): PlanObject {
  return {
    id,
    type: "token",
    base: {
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rotation: 0,
      opacity: 1,
      z: 0,
      visible: true,
    },
    ...over,
  };
}

function anim(id: string, objectId: string, over: Partial<Anim> = {}): Anim {
  return {
    id,
    objectId,
    kind: "motion",
    effect: "move",
    trigger: "afterPrevious",
    delayMs: 100,
    durationMs: 500,
    easing: "power2.out",
    ...over,
  };
}

/**
 * A definition with two owned objects and one slot: a puddle that appears, and
 * a bolt that flies at whoever the slot is bound to.
 */
function definition(over: Partial<AttackDef> = {}): AttackDef {
  return {
    id: "def_fireball",
    name: "Fireball",
    source: "plan",
    objects: [
      object("puddle", { type: "shape", shape: "voidzone" }),
      object("bolt"),
      object("target", { slotName: "the target" }),
    ],
    slide: {
      id: "def-slide",
      states: {
        puddle: state({ x: 0, y: 0 }),
        bolt: state({ x: 200, y: 0, w: 50, h: 50 }),
        target: state({ x: 400, y: 0 }),
      },
      animations: [
        anim("a_appear", "puddle", {
          kind: "entrance",
          effect: "appear",
          trigger: "onEnter",
          delayMs: 0,
          durationMs: 0,
        }),
        anim("a_fly", "bolt", {
          params: { toX: 400, toY: 0 },
        }),
        anim("a_hit", "target", {
          kind: "emphasis",
          effect: "pulse",
          trigger: "onCollision",
          collideWith: ["bolt"],
        }),
      ],
    },
    params: [],
    ...over,
  };
}

function instance(over: Partial<AttackInstance> = {}): AttackInstance {
  return {
    id: "atk_1",
    defId: "def_fireball",
    name: "Fireball",
    transform: IDENTITY_ATTACK_TRANSFORM,
    timeScale: 1,
    anchorDelayMs: 0,
    values: {},
    slots: { target: "plan_player" },
    objectMap: {},
    animMap: {},
    ...over,
  };
}

let objectSeq = 0;
let animSeq = 0;
beforeEach(() => {
  objectSeq = 0;
  animSeq = 0;
});

function context(over: Partial<StampContext> = {}): StampContext {
  return {
    def: definition(),
    instance: instance(),
    boundStates: { plan_player: state({ x: 900, y: 900 }) },
    groupId: "grp_1",
    nextObjectId: () => `obj_${++objectSeq}`,
    nextAnimId: () => `anim_${++animSeq}`,
    ...over,
  };
}

const t = (over: Partial<AttackTransform> = {}): AttackTransform => ({
  ...IDENTITY_ATTACK_TRANSFORM,
  ...over,
});

/* -------------------------------------------------------------------------- */

describe("what a stamp produces", () => {
  it("stamps only the objects the instance owns — a slot is a hole, not a thing", () => {
    const result = stampAttack(context());
    expect(result.objects).toHaveLength(2);
    expect(result.objects.every((o) => o.slotName === undefined)).toBe(true);
    expect(Object.keys(result.states).sort()).toEqual(
      result.objects.map((o) => o.id).sort(),
    );
  });

  it("marks every owned object with the instance and the group, so it selects, drags and deletes as one", () => {
    const result = stampAttack(context());
    for (const object of result.objects) {
      expect(object.attackId).toBe("atk_1");
      expect(object.groupId).toBe("grp_1");
    }
  });

  it("never marks the plan object bound to a slot, so deleting the attack cannot delete a planner's token", () => {
    const result = stampAttack(context());
    expect(result.objects.map((o) => o.id)).not.toContain("plan_player");
  });

  it("rewrites every reference to a slot to the object bound to it", () => {
    const result = stampAttack(context());
    const hit = result.animations.find((a) => a.effect === "pulse");
    expect(hit?.objectId).toBe("plan_player");
    // …and the collider it names is the *stamped* bolt, not the definition's.
    const bolt = result.objects.find((o) => o.type === "token");
    expect(hit?.collideWith).toEqual([bolt!.id]);
  });

  it("rewrites tethers and follows through the same map", () => {
    const def = definition();
    def.objects.push(
      object("tether", { type: "tether", fromId: "bolt", toId: "target" }),
      object("cone", { type: "shape", follow: { pin: "bolt", aim: "target" } }),
    );
    def.slide.states.tether = state();
    def.slide.states.cone = state();

    const result = stampAttack(context({ def }));
    const byDefId = result.instance.objectMap;
    const tether = result.objects.find((o) => o.type === "tether");
    expect(tether?.fromId).toBe(byDefId.bolt);
    expect(tether?.toId).toBe("plan_player");
    const cone = result.objects.find((o) => o.shape === undefined && o.follow);
    expect(cone?.follow).toEqual({ pin: byDefId.bolt, aim: "plan_player" });
  });

  it("drops an object the definition's own slide does not carry — its states are its cast list", () => {
    const def = definition();
    def.objects.push(object("offstage"));
    const result = stampAttack(context({ def }));
    expect(result.objects.map((o) => o.id)).toHaveLength(2);
  });
});

describe("the animation block", () => {
  it("starts absolutely, so it cannot chain onto whatever the planner authored before it", () => {
    const def = definition();
    // Authored with a relative head, which is meaningless at the top of a slide.
    def.slide.animations[0]!.trigger = "afterPrevious";
    const result = stampAttack(context({ def }));
    const firstAuto = result.animations.find(
      (a) => a.trigger !== "onCollision" && a.trigger !== "onClick",
    );
    expect(firstAuto?.trigger).toBe("onEnter");
  });

  it("keeps the timing the author gave everything after the head", () => {
    const result = stampAttack(context());
    const fly = result.animations.find((a) => a.effect === "move");
    expect(fly?.trigger).toBe("afterPrevious");
    expect(fly?.delayMs).toBe(100);
  });

  it("slides the whole attack when the anchor delay moves, and only the absolute anchors move", () => {
    const result = stampAttack(
      context({ instance: instance({ anchorDelayMs: 750 }) }),
    );
    const spans = layoutStepTimeline(result.animations).spans;
    expect(spans[0]!.startMs).toBe(750);
    // The relative leg still sits its own 100ms after the head.
    expect(spans[1]!.startMs).toBe(850);
  });

  it("stretches durations and internal delays by timeScale, leaving the anchor where it was", () => {
    const result = stampAttack(
      context({ instance: instance({ timeScale: 2, anchorDelayMs: 200 }) }),
    );
    const fly = result.animations.find((a) => a.effect === "move")!;
    expect(fly.durationMs).toBe(1000);
    expect(fly.delayMs).toBe(200);
    expect(layoutStepTimeline(result.animations).spans[0]!.startMs).toBe(200);
  });

  it("leaves deferred triggers deferred — they are conditions, not positions in the chain", () => {
    const result = stampAttack(context());
    const hit = result.animations.find((a) => a.effect === "pulse");
    expect(hit?.trigger).toBe("onCollision");
  });
});

describe("geometry", () => {
  it("moves a move's destination with the attack, in centre space", () => {
    const result = stampAttack(
      context({ instance: instance({ transform: t({ tx: 60, ty: -20 }) }) }),
    );
    const fly = result.animations.find((a) => a.effect === "move")!;
    // A pure translation moves the destination by exactly the same vector.
    expect(fly.params?.toX).toBeCloseTo(400 + 60, 9);
    expect(fly.params?.toY).toBeCloseTo(0 - 20, 9);
  });

  it("re-aims a move at the bound token's own box, which the slot it replaced was not the size of", () => {
    const def = definition();
    def.slide.animations[1] = anim("a_fly", "target", {
      params: { toX: 400, toY: 0 },
    });
    const result = stampAttack(
      context({
        def,
        boundStates: { plan_player: state({ x: 900, y: 900, w: 40, h: 40 }) },
      }),
    );
    const fly = result.animations.find((a) => a.effect === "move")!;
    // The destination's *centre* is unchanged by an identity placement; the
    // stored top-left moves because the token is 40 wide where the slot was 100.
    expect(fly.params!.toX! + 20).toBeCloseTo(400 + 50, 9);
    expect(fly.params!.toY! + 20).toBeCloseTo(0 + 50, 9);
  });

  it("moves a drawn route's waypoints with the attack", () => {
    const def = definition();
    def.slide.animations[1]!.params = {
      toX: 400,
      toY: 0,
      path: [{ x: 300, y: 100 }],
    };
    const result = stampAttack(
      context({
        def,
        instance: instance({ transform: t({ tx: 10, ty: 10 }) }),
      }),
    );
    const fly = result.animations.find((a) => a.effect === "move")!;
    expect(fly.params?.path).toEqual([{ x: 310, y: 110 }]);
  });
});

describe("parameters", () => {
  const colour: AttackParam = {
    name: "colour",
    label: "Colour",
    kind: "color",
    value: "#ff0000",
    targets: [{ on: "object", targetId: "puddle", field: "tint" }],
  };
  const cast: AttackParam = {
    name: "cast",
    label: "Cast time",
    kind: "number",
    value: 500,
    targets: [{ on: "anim", targetId: "a_fly", field: "durationMs" }],
  };

  it("uses the author's default when the placement says nothing", () => {
    const result = stampAttack(
      context({ def: definition({ params: [colour] }) }),
    );
    expect(result.objects[0]!.base.tint).toBe("#ff0000");
  });

  it("writes the placement's own value where the binding points", () => {
    const result = stampAttack(
      context({
        def: definition({ params: [colour] }),
        instance: instance({ values: { colour: "#00ff00" } }),
      }),
    );
    expect(result.objects[0]!.base.tint).toBe("#00ff00");
  });

  it("applies a parameter before timeScale, so a cast time means the same thing in every placement", () => {
    const result = stampAttack(
      context({
        def: definition({ params: [cast] }),
        instance: instance({ values: { cast: 800 }, timeScale: 2 }),
      }),
    );
    const fly = result.animations.find((a) => a.effect === "move")!;
    expect(fly.durationMs).toBe(1600);
  });

  it("takes a collideWith parameter as plan ids, because naming your own tokens is the point of exposing it", () => {
    const targets: AttackParam = {
      name: "hurts",
      label: "Hurts",
      kind: "objects",
      value: [],
      targets: [{ on: "anim", targetId: "a_hit", field: "collideWith" }],
    };
    const result = stampAttack(
      context({
        def: definition({ params: [targets] }),
        instance: instance({ values: { hurts: ["plan_tank", "plan_healer"] } }),
      }),
    );
    const hit = result.animations.find((a) => a.effect === "pulse")!;
    expect(hit.collideWith).toEqual(["plan_tank", "plan_healer"]);
  });

  it("two placements of one definition are independent", () => {
    const def = definition({ params: [colour] });
    const one = stampAttack(
      context({ def, instance: instance({ values: { colour: "#111111" } }) }),
    );
    const two = stampAttack(
      context({
        def,
        instance: instance({ id: "atk_2", values: { colour: "#222222" } }),
      }),
    );
    expect(one.objects[0]!.base.tint).toBe("#111111");
    expect(two.objects[0]!.base.tint).toBe("#222222");
  });
});

describe("re-stamping", () => {
  it("reuses the ids it minted, so a tether the planner drew into the attack survives", () => {
    const first = stampAttack(context());
    const second = stampAttack(
      context({
        instance: { ...first.instance, transform: t({ tx: 500, ty: 500 }) },
      }),
    );
    expect(second.objects.map((o) => o.id)).toEqual(
      first.objects.map((o) => o.id),
    );
    expect(second.animations.map((a) => a.id)).toEqual(
      first.animations.map((a) => a.id),
    );
    expect(second.instance.objectMap).toEqual(first.instance.objectMap);
  });

  it("DRIFT: A, then B, then A again is byte-identical to A once — the invariant the whole design exists for", () => {
    const A = t({ tx: 37, ty: -19, rotationDeg: 23, sx: 1.7, sy: 0.6 });
    const B = t({ tx: -400, ty: 250, rotationDeg: -110, sx: 0.25, sy: 4 });

    // The same placement, dragged around and brought back.
    let recipe = instance({ transform: A });
    for (const transform of [B, A, B, B, A]) {
      const step = stampAttack(context({ instance: { ...recipe, transform } }));
      recipe = step.instance;
    }
    const back = stampAttack(
      context({ instance: { ...recipe, transform: A } }),
    );

    // Stamped from the same recipe, arrived at by the short route. Sharing the
    // id maps is the point: what is being compared is the *geometry* two
    // different histories produce, not which ids the fixture happened to mint.
    const once = stampAttack(
      context({
        instance: {
          ...instance({ transform: A }),
          objectMap: recipe.objectMap,
          animMap: recipe.animMap,
        },
      }),
    );

    expect(JSON.stringify(back.objects)).toBe(JSON.stringify(once.objects));
    expect(JSON.stringify(back.states)).toBe(JSON.stringify(once.states));
    expect(JSON.stringify(back.animations)).toBe(
      JSON.stringify(once.animations),
    );
  });

  it("DRIFT: retiming out and back restores the authored durations exactly", () => {
    const authored = stampAttack(context());
    let recipe = instance();
    for (const timeScale of [3, 0.1, 7.7, 1.3, 1]) {
      recipe = stampAttack(
        context({ instance: { ...recipe, timeScale } }),
      ).instance;
    }
    const back = stampAttack(
      context({ instance: { ...recipe, timeScale: 1 } }),
    );
    expect(back.animations.map((a) => [a.delayMs, a.durationMs])).toEqual(
      authored.animations.map((a) => [a.delayMs, a.durationMs]),
    );
  });
});
