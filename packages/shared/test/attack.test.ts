import { describe, expect, it } from "vitest";
import {
  ATTACK_AUTHORING_SIZE,
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

/**
 * Attacks are stored in **unit space**: -1..1 centred, where (0,0) is the middle
 * of the placed rectangle and ±1 its edges. Lengths are unit lengths, so 2 spans
 * the rectangle and a length scales by `w/2` / `h/2` — independently, which is
 * why a non-square rectangle stretches an attack.
 */
const base = (over: Partial<ObjectBase> = {}): ObjectBase => ({
  x: 0,
  y: 0,
  w: 0.5,
  h: 0.5,
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
  defaultSize: { w: 400, h: 400 },
  objects: [defObj("o1")],
  overrides: {},
  animations: [],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, tint: {} },
  ...over,
});

/**
 * The default instance covers (0,0)‥(200,200): centre (100,100), half-extents
 * 100. So unit (0,0) lands at (100,100) and unit (1,0) at (200,100).
 */
const inst = (over: Partial<AttackInstance> = {}): AttackInstance => ({
  id: "i1",
  attackId: "atk",
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  rotation: 0,
  startMs: 0,
  args: {},
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

const expandOne = (def: AttackDef, instance: AttackInstance) =>
  expandPlan(makePlan([step({ attacks: [instance] })]), { atk: def });

describe("AttackDefSchema", () => {
  it("defaults version, placement hint and end state", () => {
    const def = AttackDefSchema.parse({
      id: "a",
      encounterId: "e",
      name: "n",
      objects: [],
      animations: [],
    });
    expect(def.version).toBe(1);
    expect(def.defaultSize).toEqual({ w: 400, h: 400 });
    expect(def.overrides).toEqual({});
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

describe("expandPlan — placement maths", () => {
  it("puts unit origin at the centre of the instance rectangle", () => {
    const out = expandOne(makeDef({ objects: [defObj("c")] }), inst());
    expect(lastObject(out).base).toMatchObject({ x: 100, y: 100 });
  });

  it("puts unit ±1 on the rectangle's edges", () => {
    const def = makeDef({ objects: [defObj("c", { x: 1, y: -1 })] });
    const out = expandOne(def, inst());
    expect(lastObject(out).base).toMatchObject({ x: 200, y: 0 });
  });

  it("scales lengths by the half-extents", () => {
    // A unit length of 2 spans the rectangle, so 0.5 → a quarter of it.
    const def = makeDef({ objects: [defObj("c", { w: 0.5, h: 2 })] });
    const out = expandOne(def, inst());
    expect(lastObject(out).base).toMatchObject({ w: 50, h: 200 });
  });

  it("stretches independently in a non-square rectangle", () => {
    const def = makeDef({ objects: [defObj("c", { x: 1, y: 1, w: 1, h: 1 })] });
    const out = expandOne(def, inst({ w: 400, h: 100 }));
    // centre (200,50), halves (200,50).
    expect(lastObject(out).base).toMatchObject({
      x: 400,
      y: 100,
      w: 200,
      h: 50,
    });
  });

  it("follows the rectangle when it moves", () => {
    const out = expandOne(
      makeDef({ objects: [defObj("c")] }),
      inst({ x: 1000, y: 500 }),
    );
    expect(lastObject(out).base).toMatchObject({ x: 1100, y: 600 });
  });

  it("rotates clockwise about the centre and adds to the object's rotation", () => {
    const def = makeDef({
      objects: [defObj("c", { x: 1, y: 0, rotation: 15 })],
    });
    const out = expandOne(def, inst({ rotation: 90 }));
    const b = lastObject(out).base;
    // (1,0) is the right edge; a quarter turn puts it at the bottom edge.
    expect(b.x).toBeCloseTo(100);
    expect(b.y).toBeCloseTo(200);
    expect(b.rotation).toBe(105);
  });
});

describe("expandPlan — stamping", () => {
  it("adds namespaced, initially-hidden objects and clears the instances", () => {
    const out = expandOne(makeDef({ objects: [defObj("cone")] }), inst());
    const cone = out.objects.find((o) => o.id === "i1::cone");
    expect(cone).toBeDefined();
    expect(cone!.base.visible).toBe(false);
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
    const out = expandOne(makeDef(), inst());
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
    const own = defObj("boss");
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

describe("expandPlan — end-state overrides", () => {
  it("places the def's end state onto the instance's step, made present", () => {
    const def = makeDef({
      objects: [defObj("c")],
      overrides: { c: { x: 1, y: 0 } },
    });
    const out = expandOne(def, inst());
    expect(out.steps[0]!.overrides["i1::c"]).toEqual({
      x: 200,
      y: 100,
      visible: true,
    });
  });

  it("honours a def end state that hides the object (a disappear)", () => {
    const def = makeDef({
      objects: [defObj("c")],
      overrides: { c: { visible: false } },
    });
    const out = expandOne(def, inst());
    expect(out.steps[0]!.overrides["i1::c"]).toEqual({ visible: false });
  });
});

describe("expandPlan — animations", () => {
  it("retargets and offsets animations, and maps their params", () => {
    const def = makeDef({
      objects: [defObj("c")],
      animations: [
        defAnim({
          objectId: "c",
          effect: "move",
          delayMs: 100,
          params: { toX: 1, toY: 0 },
        }),
      ],
    });
    const out = expandOne(def, inst({ startMs: 200 }));
    const anim = out.steps[0]!.animations.find((a) => a.id === "i1::a1")!;
    expect(anim.objectId).toBe("i1::c");
    expect(anim.delayMs).toBe(300); // 100 + startMs 200
    expect(anim.params).toMatchObject({ toX: 200, toY: 100 });
  });

  it("maps a motion path point by point", () => {
    const def = makeDef({
      objects: [defObj("c")],
      animations: [
        defAnim({
          objectId: "c",
          params: {
            path: [
              { x: -1, y: -1 },
              { x: 1, y: 1 },
            ],
          },
        }),
      ],
    });
    const out = expandOne(def, inst());
    const anim = out.steps[0]!.animations.find((a) => a.id === "i1::a1")!;
    expect(anim.params!.path).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 200 },
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
    const out = expandOne(def, inst());
    const anim = out.steps[0]!.animations.find((a) => a.id === "i1::hit")!;
    expect(anim.collideWith).toEqual(["i1::tank"]);
    expect(out.objects.find((o) => o.id === "i1::tether")).toMatchObject({
      fromId: "i1::orb",
      toId: "i1::tank",
    });
  });
});

describe("expandPlan — parameters", () => {
  /** A pickup whose collision targets the *plan* supplies (plan §18.4). */
  const catchable = (over = {}) =>
    makeDef({
      objects: [defObj("orb")],
      animations: [
        defAnim({
          id: "caught",
          objectId: "orb",
          trigger: "onCollision",
          collideWith: ["orb"],
        }),
      ],
      params: [{ key: "victims", label: "Caught by", type: "objectRefs" }],
      bindings: {
        collideWith: { caught: "victims" },
        durationMs: {},
        tint: {},
      },
      ...over,
    });

  it("takes collision targets from the plan, un-namespaced", () => {
    const out = expandOne(catchable(), inst({ args: { victims: ["tank-1"] } }));
    const anim = out.steps[0]!.animations.find((a) => a.id === "i1::caught")!;
    // A plan's own object id, used as given — namespacing it would point at
    // nothing.
    expect(anim.collideWith).toEqual(["tank-1"]);
  });

  it("falls back to the parameter's default when the plan says nothing", () => {
    const def = catchable({
      params: [
        {
          key: "victims",
          label: "Caught by",
          type: "objectRefs",
          default: ["boss"],
        },
      ],
    });
    const out = expandOne(def, inst());
    const anim = out.steps[0]!.animations.find((a) => a.id === "i1::caught")!;
    expect(anim.collideWith).toEqual(["boss"]);
  });

  it("still namespaces an unbound, literal collideWith", () => {
    const def = makeDef({
      objects: [defObj("orb"), defObj("tank")],
      animations: [
        defAnim({
          id: "hit",
          objectId: "orb",
          trigger: "onCollision",
          collideWith: ["tank"],
        }),
      ],
    });
    const out = expandOne(def, inst());
    const anim = out.steps[0]!.animations.find((a) => a.id === "i1::hit")!;
    expect(anim.collideWith).toEqual(["i1::tank"]);
  });

  it("binds a tint and a duration", () => {
    const def = makeDef({
      objects: [defObj("orb")],
      animations: [defAnim({ id: "a1", objectId: "orb", durationMs: 500 })],
      params: [
        { key: "colour", label: "Colour", type: "color" },
        { key: "speed", label: "Duration", type: "number" },
      ],
      bindings: {
        collideWith: {},
        durationMs: { a1: "speed" },
        tint: { orb: "colour" },
      },
    });
    const out = expandOne(
      def,
      inst({ args: { colour: "#ff0000", speed: 1200 } }),
    );
    expect(lastObject(out).base.tint).toBe("#ff0000");
    expect(out.steps[0]!.animations[0]!.durationMs).toBe(1200);
  });

  it("leaves values alone when a binding has no argument or default", () => {
    const def = makeDef({
      objects: [defObj("orb", { tint: "#123456" })],
      animations: [defAnim({ id: "a1", objectId: "orb", durationMs: 500 })],
      params: [{ key: "colour", label: "Colour", type: "color" }],
      bindings: {
        collideWith: {},
        durationMs: { a1: "missing" },
        tint: { orb: "colour" },
      },
    });
    const out = expandOne(def, inst());
    expect(lastObject(out).base.tint).toBe("#123456");
    expect(out.steps[0]!.animations[0]!.durationMs).toBe(500);
  });
});

describe("defToPlan / planToAttackContent", () => {
  it("denormalises unit space onto the square authoring canvas", () => {
    const def = makeDef({
      objects: [defObj("o1", { x: 0.5, y: -0.5, w: 0.25 })],
    });
    const plan = defToPlan(def);

    expect(plan.background).toEqual({
      assetId: ATTACK_BOX_ASSET,
      width: ATTACK_AUTHORING_SIZE,
      height: ATTACK_AUTHORING_SIZE,
    });
    // Half the canvas is 500, so 0.5 → 750 and -0.5 → 250.
    expect(plan.objects[0]!.base).toMatchObject({ x: 750, y: 250, w: 125 });
    expect(plan.steps).toHaveLength(1);
  });

  it("round-trips a def's body back to unit space", () => {
    const def = makeDef({
      objects: [defObj("o1", { x: 0.5, y: -0.5, w: 0.25, h: 0.75 })],
      overrides: { o1: { x: -1, w: 2 } },
      animations: [defAnim({ objectId: "o1", params: { toX: 0.25, toY: 0 } })],
    });

    const content = planToAttackContent(defToPlan(def), {
      name: "Renamed",
      defaultSize: { w: 300, h: 200 },
    });

    expect(content.name).toBe("Renamed");
    expect(content.defaultSize).toEqual({ w: 300, h: 200 });
    expect(content.objects[0]!.base).toMatchObject(def.objects[0]!.base);
    expect(content.overrides).toEqual(def.overrides);
    expect(content.animations[0]!.params).toEqual({ toX: 0.25, toY: 0 });
  });
});

describe("expandPlan — result is a valid plan", () => {
  it("round-trips through the document schema", () => {
    const def = makeDef({
      objects: [defObj("c", { x: 0.5, y: 0.5 })],
      animations: [defAnim({ objectId: "c", params: { toX: 1, toY: 1 } })],
    });
    const plan = makePlan([
      step({ id: "s0", attacks: [inst()] }),
      step({ id: "s1" }),
    ]);
    expect(() =>
      PlanSchema.parse(expandPlan(plan, { atk: def })),
    ).not.toThrow();
  });
});
