import { describe, expect, it } from "vitest";
import {
  ATTACK_BOX_ASSET,
  AttackDefSchema,
  attackIdsInPlan,
  defToPlan,
  expandPlan,
  planToAttackContent,
  type AttackDef,
} from "../src/attack.js";
import {
  PlanSchema,
  SCHEMA_VERSION,
  type Anim,
  type AttackInstance,
  type ObjectBase,
  type Plan,
  type PlanObject,
  type Step,
} from "../src/plan.js";

const base = (over: Partial<ObjectBase> = {}): ObjectBase => ({
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rotation: 0,
  opacity: 1,
  z: 0,
  visible: true,
  ...over,
});

const defObj = (id: string, over: Partial<ObjectBase> = {}): PlanObject => ({
  id,
  type: "shape",
  shape: "circle",
  base: base(over),
});

const defAnim = (over: Partial<Anim> = {}): Anim => ({
  id: "a1",
  objectId: "o1",
  kind: "motion",
  effect: "move",
  trigger: "onEnter",
  delayMs: 0,
  durationMs: 500,
  easing: "none",
  ...over,
});

const makeDef = (over: Partial<AttackDef> = {}): AttackDef => ({
  id: "atk",
  encounterId: "enc",
  name: "Cone",
  version: 1,
  box: { w: 100, h: 100 },
  anchor: { x: 0, y: 0 },
  objects: [defObj("o1")],
  overrides: {},
  animations: [],
  ...over,
});

const inst = (over: Partial<AttackInstance> = {}): AttackInstance => ({
  id: "i1",
  attackId: "atk",
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1,
  startMs: 0,
  ...over,
});

const step = (over: Partial<Step> = {}): Step => ({
  id: "s1",
  overrides: {},
  animations: [],
  ...over,
});

const makePlan = (steps: Step[], objects: PlanObject[] = []): Plan => ({
  id: "p",
  title: "t",
  raid: "",
  background: { assetId: "arena", width: 1600, height: 900 },
  objects,
  steps,
  schemaVersion: SCHEMA_VERSION,
});

/** The last object in the expanded plan — the one an attack just added. */
const lastObject = (plan: Plan) => plan.objects.at(-1)!;

describe("AttackDefSchema", () => {
  it("defaults version and scale-free fields sanely", () => {
    const def = AttackDefSchema.parse({
      id: "a",
      encounterId: "e",
      name: "n",
      box: { w: 10, h: 10 },
      anchor: { x: 0, y: 0 },
      objects: [],
      animations: [],
    });
    expect(def.version).toBe(1);
  });
});

describe("attackIdsInPlan", () => {
  it("collects distinct attack ids across steps", () => {
    const plan = makePlan([
      step({
        id: "s0",
        attacks: [inst({ attackId: "a" }), inst({ attackId: "b" })],
      }),
      step({ id: "s1", attacks: [inst({ attackId: "a" })] }),
    ]);
    expect(attackIdsInPlan(plan).sort()).toEqual(["a", "b"]);
  });

  it("is empty for a plan with no attacks", () => {
    expect(attackIdsInPlan(makePlan([step()]))).toEqual([]);
  });
});

describe("expandPlan — the common case is free", () => {
  it("returns the very same plan when nothing has attacks", () => {
    const plan = makePlan([step()]);
    expect(expandPlan(plan, {})).toBe(plan);
  });
});

describe("expandPlan — stamping", () => {
  it("adds namespaced, initially-hidden objects and clears the instances", () => {
    const def = makeDef({ objects: [defObj("cone", { x: 50, y: 50 })] });
    const plan = makePlan([step({ attacks: [inst({ x: 200, y: 300 })] })]);

    const out = expandPlan(plan, { atk: def });
    const cone = out.objects.find((o) => o.id === "i1::cone");
    expect(cone).toBeDefined();
    expect(cone!.base.visible).toBe(false);
    // anchor (0,0) + object (50,50) placed at instance (200,300), scale 1.
    expect(cone!.base).toMatchObject({ x: 250, y: 350 });
    expect(out.steps[0]!.attacks).toEqual([]);
  });

  it("bounds visibility to the instance's step", () => {
    const plan = makePlan([
      step({ id: "s0", attacks: [inst()] }),
      step({ id: "s1" }),
    ]);
    const out = expandPlan(plan, { atk: makeDef() });
    expect(out.steps[0]!.overrides["i1::o1"]).toEqual({ visible: true });
    expect(out.steps[1]!.overrides["i1::o1"]).toEqual({ visible: false });
  });

  it("adds no trailing override when the attack is on the last step", () => {
    const out = expandPlan(makePlan([step({ attacks: [inst()] })]), {
      atk: makeDef(),
    });
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]!.overrides["i1::o1"]).toEqual({ visible: true });
  });

  it("skips an instance whose def is missing, leaving the rest renderable", () => {
    const out = expandPlan(
      makePlan([step({ attacks: [inst({ attackId: "ghost" })] })]),
      {},
    );
    expect(out.objects).toEqual([]);
    expect(out.steps[0]!.attacks).toEqual([]);
  });

  it("keeps two instances of one def from colliding", () => {
    const plan = makePlan([
      step({ attacks: [inst({ id: "i1" }), inst({ id: "i2" })] }),
    ]);
    const out = expandPlan(plan, { atk: makeDef() });
    const ids = out.objects.map((o) => o.id);
    expect(ids).toContain("i1::o1");
    expect(ids).toContain("i2::o1");
  });

  it("preserves the plan's own objects and step animations", () => {
    const own = defObj("boss", { x: 800, y: 450 });
    const ownAnim = defAnim({ id: "own", objectId: "boss" });
    const def = makeDef({ animations: [defAnim({ objectId: "o1" })] });
    const plan = makePlan(
      [step({ animations: [ownAnim], attacks: [inst()] })],
      [own],
    );
    const out = expandPlan(plan, { atk: def });
    expect(out.objects[0]).toBe(own);
    expect(out.steps[0]!.animations[0]).toBe(ownAnim);
    expect(out.steps[0]!.animations).toHaveLength(2); // own + expanded
  });
});

describe("expandPlan — placement maths", () => {
  it("lands an anchored object exactly at the instance position", () => {
    const def = makeDef({
      anchor: { x: 50, y: 50 },
      objects: [defObj("c", { x: 50, y: 50 })],
    });
    const out = expandPlan(
      makePlan([step({ attacks: [inst({ x: 100, y: 120 })] })]),
      { atk: def },
    );
    expect(lastObject(out).base).toMatchObject({ x: 100, y: 120 });
  });

  it("scales size and offset about the anchor", () => {
    const def = makeDef({
      anchor: { x: 0, y: 0 },
      objects: [defObj("c", { x: 10, y: 0, w: 10, h: 20 })],
    });
    const out = expandPlan(
      makePlan([step({ attacks: [inst({ scale: 2 })] })]),
      { atk: def },
    );
    expect(lastObject(out).base).toMatchObject({ x: 20, y: 0, w: 20, h: 40 });
  });

  it("rotates the offset clockwise and adds to the object's rotation", () => {
    const def = makeDef({
      anchor: { x: 0, y: 0 },
      objects: [defObj("c", { x: 10, y: 0, rotation: 15 })],
    });
    const out = expandPlan(
      makePlan([step({ attacks: [inst({ rotation: 90 })] })]),
      { atk: def },
    );
    const b = lastObject(out).base;
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(10);
    expect(b.rotation).toBe(105);
  });
});

describe("expandPlan — animations", () => {
  it("retargets and offsets animations, and transforms their params", () => {
    const def = makeDef({
      anchor: { x: 0, y: 0 },
      objects: [defObj("c")],
      animations: [
        defAnim({
          objectId: "c",
          effect: "move",
          delayMs: 100,
          params: { toX: 10, toY: 0 },
        }),
      ],
    });
    const out = expandPlan(
      makePlan([step({ attacks: [inst({ x: 5, y: 5, startMs: 200 })] })]),
      { atk: def },
    );
    const anim = out.steps[0]!.animations.find((a) => a.id === "i1::a1")!;
    expect(anim.objectId).toBe("i1::c");
    expect(anim.delayMs).toBe(300); // 100 + startMs 200
    expect(anim.params).toMatchObject({ toX: 15, toY: 5 });
  });

  it("transforms a motion path point by point", () => {
    const def = makeDef({
      objects: [defObj("c")],
      animations: [
        defAnim({
          objectId: "c",
          params: {
            path: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
          },
        }),
      ],
    });
    const out = expandPlan(
      makePlan([step({ attacks: [inst({ x: 5, y: 5 })] })]),
      { atk: def },
    );
    const anim = out.steps[0]!.animations.find((a) => a.id === "i1::a1")!;
    expect(anim.params!.path).toEqual([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
    ]);
  });

  it("namespaces collideWith and tether endpoints", () => {
    const def = makeDef({
      objects: [
        defObj("orb"),
        defObj("tank"),
        {
          id: "tether",
          type: "tether",
          fromId: "orb",
          toId: "tank",
          base: base(),
        },
      ],
      animations: [
        defAnim({
          id: "hit",
          objectId: "orb",
          trigger: "onCollision",
          collideWith: ["tank"],
        }),
      ],
    });
    const out = expandPlan(makePlan([step({ attacks: [inst()] })]), {
      atk: def,
    });
    const anim = out.steps[0]!.animations.find((a) => a.id === "i1::hit")!;
    expect(anim.collideWith).toEqual(["i1::tank"]);
    const tether = out.objects.find((o) => o.id === "i1::tether")!;
    expect(tether).toMatchObject({ fromId: "i1::orb", toId: "i1::tank" });
  });
});

describe("expandPlan — end-state overrides", () => {
  it("places the def's end state onto the instance's step, made present", () => {
    const def = makeDef({
      anchor: { x: 0, y: 0 },
      objects: [defObj("c")],
      overrides: { c: { x: 10, y: 0 } },
    });
    const out = expandPlan(
      makePlan([step({ attacks: [inst({ x: 5, y: 5 })] })]),
      { atk: def },
    );
    expect(out.steps[0]!.overrides["i1::c"]).toEqual({
      x: 15,
      y: 5,
      visible: true,
    });
  });

  it("honours a def end state that hides the object (a disappear)", () => {
    const def = makeDef({
      objects: [defObj("c")],
      overrides: { c: { visible: false } },
    });
    const out = expandPlan(makePlan([step({ attacks: [inst()] })]), {
      atk: def,
    });
    expect(out.steps[0]!.overrides["i1::c"]).toEqual({ visible: false });
  });
});

describe("defToPlan / planToAttackContent", () => {
  it("presents a def as a one-step plan on a box-sized blank canvas", () => {
    const def = makeDef({
      name: "Sweep",
      box: { w: 300, h: 200 },
      objects: [defObj("o1")],
      overrides: { o1: { x: 5 } },
      animations: [defAnim({ objectId: "o1" })],
    });
    const plan = defToPlan(def);
    expect(plan.background).toEqual({
      assetId: ATTACK_BOX_ASSET,
      width: 300,
      height: 200,
    });
    expect(plan.title).toBe("Sweep");
    expect(plan.objects).toBe(def.objects);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.overrides).toBe(def.overrides);
    expect(plan.steps[0]!.animations).toBe(def.animations);
  });

  it("round-trips a def's body back out", () => {
    const def = makeDef({
      box: { w: 300, h: 200 },
      objects: [defObj("o1", { x: 3 })],
      overrides: { o1: { x: 5 } },
      animations: [defAnim({ objectId: "o1" })],
    });
    const content = planToAttackContent(defToPlan(def), {
      name: "Renamed",
      anchor: { x: 1, y: 2 },
    });
    expect(content).toMatchObject({
      name: "Renamed",
      anchor: { x: 1, y: 2 },
      box: { w: 300, h: 200 },
      objects: def.objects,
      overrides: def.overrides,
      animations: def.animations,
    });
  });
});

describe("expandPlan — result is a valid plan", () => {
  it("round-trips through the document schema", () => {
    const def = makeDef({
      objects: [defObj("c", { x: 10, y: 10 })],
      animations: [defAnim({ objectId: "c", params: { toX: 20, toY: 20 } })],
    });
    const plan = makePlan([
      step({ id: "s0", attacks: [inst()] }),
      step({ id: "s1" }),
    ]);
    const out = expandPlan(plan, { atk: def });
    expect(() => PlanSchema.parse(out)).not.toThrow();
  });
});
