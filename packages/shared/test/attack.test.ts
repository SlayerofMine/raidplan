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
 *
 * Unit space is the attack's *own* extent, so a stored definition always spans
 * -1..1 exactly: nothing can sit outside its own bounding box. The default
 * fixture object therefore fills unit space, and tests that place a part inside
 * it add a second object.
 */
const base = (over: Partial<ObjectBase> = {}): ObjectBase => ({
  x: -1,
  y: -1,
  w: 2,
  h: 2,
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
  stepId: "s1",
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

const makePlan = (
  steps: Step[],
  objects: PlanObject[] = [],
  attacks: AttackInstance[] = [],
): Plan => ({
  id: "p",
  title: "t",
  raid: "",
  background: { assetId: "arena", width: 1600, height: 900 },
  objects,
  attacks,
  steps,
  schemaVersion: SCHEMA_VERSION,
});

/** The last object in the expanded plan — the one an attack just added. */
const lastObject = (plan: Plan) => plan.objects.at(-1)!;

/** One expanded animation, by its namespaced id. */
const animById = (plan: Plan, id: string, stepIndex = 0) =>
  plan.steps[stepIndex]!.animations.find((a) => a.id === id)!;

const expandOne = (def: AttackDef, instance: AttackInstance) =>
  expandPlan(makePlan([step()], [], [instance]), { atk: def });

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
  it("collects distinct attack ids across the plan", () => {
    const plan = makePlan(
      [step({ id: "s0" }), step({ id: "s1" })],
      [],
      [
        inst({ attackId: "a" }),
        inst({ attackId: "b" }),
        inst({ attackId: "a", stepId: "s1" }),
      ],
    );
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
  /** A part inside the attack, alongside something that spans its extent. */
  const withPart = (part: Partial<ObjectBase>) =>
    makeDef({ objects: [defObj("span"), defObj("part", part)] });
  const part = (plan: Plan) => plan.objects.find((o) => o.id === "i1::part")!;

  it("fits the attack's own extent onto the instance rectangle", () => {
    const out = expandOne(makeDef({ objects: [defObj("c")] }), inst());
    // The rectangle *is* the attack's bounding box — that's the whole point of
    // dragging a Transformer handle instead of typing coordinates.
    expect(lastObject(out).base).toMatchObject({ x: 0, y: 0, w: 200, h: 200 });
  });

  it("puts a part where its unit coordinates say, ±1 being the edges", () => {
    const out = expandOne(withPart({ x: 0.5, y: -1, w: 0.5, h: 0.5 }), inst());
    // Centre (100,100), half-extents 100: 0.5 → 150 across, -1 → the top edge.
    expect(part(out).base).toMatchObject({ x: 150, y: 0, w: 50, h: 50 });
  });

  it("stretches independently in a non-square rectangle", () => {
    const out = expandOne(
      withPart({ x: 0.5, y: -1, w: 0.5, h: 0.5 }),
      inst({ w: 400, h: 100 }),
    );
    // Centre (200,50), halves (200,50) — x and y scale by different factors.
    expect(part(out).base).toMatchObject({ x: 300, y: 0, w: 100, h: 25 });
  });

  it("follows the rectangle when it moves", () => {
    const out = expandOne(
      makeDef({ objects: [defObj("c")] }),
      inst({ x: 1000, y: 500 }),
    );
    expect(lastObject(out).base).toMatchObject({ x: 1000, y: 500 });
  });

  it("rotates clockwise about the rectangle's centre", () => {
    const out = expandOne(
      makeDef({ objects: [defObj("c")] }),
      inst({ rotation: 90 }),
    );
    const b = lastObject(out).base;
    // Its top-left corner is at unit (-1,-1); a quarter turn swings that round
    // to the rectangle's top-right.
    expect(b.x).toBeCloseTo(200);
    expect(b.y).toBeCloseTo(0);
  });

  it("adds the instance's rotation to a part's own", () => {
    const out = expandOne(
      withPart({ x: -0.5, y: -0.5, w: 1, h: 1, rotation: 15 }),
      inst({ rotation: 90 }),
    );
    expect(part(out).base.rotation).toBe(105);
  });

  it("fits a definition drawn well inside its own space, so old ones self-correct", () => {
    // Nothing guarantees stored coordinates span -1..1 — a definition authored
    // before the extent rule, say. It still fills the rectangle it is dropped
    // into rather than rattling around in the middle of it.
    const def = makeDef({
      objects: [defObj("c", { x: -0.2, y: -0.2, w: 0.4, h: 0.4 })],
    });
    const out = expandOne(def, inst());
    expect(lastObject(out).base).toMatchObject({ x: 0, y: 0, w: 200, h: 200 });
  });
});

describe("expandPlan — stamping", () => {
  it("adds namespaced, initially-hidden objects and clears the instances", () => {
    const out = expandOne(makeDef({ objects: [defObj("cone")] }), inst());
    const cone = out.objects.find((o) => o.id === "i1::cone");
    expect(cone).toBeDefined();
    expect(cone!.base.visible).toBe(false);
    expect(out.attacks).toEqual([]);
  });

  it("bounds visibility to the instance's step", () => {
    const plan = makePlan(
      [step({ id: "s1" }), step({ id: "s2" })],
      [],
      [inst()],
    );
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
      makePlan([step()], [], [inst({ attackId: "ghost" })]),
      {},
    );
    expect(out.objects).toEqual([]);
    expect(out.attacks).toEqual([]);
  });

  it("skips an instance whose step has been deleted", () => {
    const out = expandPlan(
      makePlan([step({ id: "s1" })], [], [inst({ stepId: "gone" })]),
      { atk: makeDef() },
    );
    expect(out.objects).toEqual([]);
  });

  it("keeps two instances of one def from colliding", () => {
    const plan = makePlan(
      [step()],
      [],
      [inst({ id: "i1" }), inst({ id: "i2" })],
    );
    const out = expandPlan(plan, { atk: makeDef() });
    const ids = out.objects.map((o) => o.id);
    expect(ids).toContain("i1::o1");
    expect(ids).toContain("i2::o1");
  });

  it("preserves the plan's own objects and step animations", () => {
    const own = defObj("boss");
    const ownAnim = defAnim({ id: "own", objectId: "boss" });
    const def = makeDef({ animations: [defAnim({ objectId: "o1" })] });
    const plan = makePlan([step({ animations: [ownAnim] })], [own], [inst()]);
    const out = expandPlan(plan, { atk: def });
    expect(out.objects[0]).toBe(own);
    expect(out.steps[0]!.animations[0]).toBe(ownAnim);
    // own + the def's, + the implicit entrance that reveals the attack.
    expect(out.steps[0]!.animations).toHaveLength(3);
  });
});

describe("expandPlan — end-state overrides", () => {
  it("places the def's end state onto the instance's step, made present", () => {
    // A half-width part that slides across: its life spans unit space, so the
    // rectangle covers the whole sweep.
    const def = makeDef({
      objects: [defObj("c", { x: -1, y: -1, w: 1, h: 2 })],
      overrides: { c: { x: 0 } },
    });
    const out = expandOne(def, inst());
    // Ends at the middle of the rectangle; the y it never changed comes along,
    // because a rotated placement can't express one axis alone.
    expect(out.steps[0]!.overrides["i1::c"]).toEqual({
      x: 100,
      y: 0,
      visible: true,
    });
  });

  it("honours a def end state that hides the object (a disappear)", () => {
    const def = makeDef({
      objects: [defObj("c")],
      overrides: { c: { visible: false } },
    });
    const out = expandOne(def, inst());
    expect(out.steps[0]!.overrides["i1::c"]).toMatchObject({ visible: false });
  });
});

describe("expandPlan — animations", () => {
  it("retargets and offsets animations, and maps their params", () => {
    const def = makeDef({
      objects: [defObj("c", { x: -1, y: -1, w: 1, h: 2 })],
      animations: [
        defAnim({
          objectId: "c",
          effect: "move",
          delayMs: 100,
          params: { toX: 0, toY: -1 },
        }),
      ],
    });
    const out = expandOne(def, inst({ startMs: 200 }));
    const anim = animById(out, "i1::a1");
    expect(anim.objectId).toBe("i1::c");
    expect(anim.delayMs).toBe(300); // 100 + startMs 200
    expect(anim.params).toMatchObject({ toX: 100, toY: 0 });
  });

  it("maps a motion path point by point", () => {
    const def = makeDef({
      objects: [defObj("c", { x: -1, y: -1, w: 0.5, h: 0.5 })],
      animations: [
        defAnim({
          objectId: "c",
          params: {
            path: [
              { x: -1, y: -1 },
              { x: 0.5, y: 0.5 },
            ],
          },
        }),
      ],
    });
    const out = expandOne(def, inst());
    // The path is part of the attack's extent, so the sweep spans the rectangle.
    expect(animById(out, "i1::a1").params!.path).toEqual([
      { x: 0, y: 0 },
      { x: 150, y: 150 },
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

describe("expandPlan — an attack shows itself", () => {
  /**
   * Materialising an attack's parts hidden is what keeps them off the steps
   * around it — but nothing tweens `visible`, so without an entrance the attack
   * would play out invisibly. The expansion supplies one.
   */
  it("reveals a part with no entrance of its own, when the attack fires", () => {
    const out = expandOne(
      makeDef({ objects: [defObj("cone")] }),
      inst({ startMs: 300 }),
    );
    const enter = animById(out, "i1::cone#enter");
    expect(enter).toMatchObject({
      objectId: "i1::cone",
      kind: "entrance",
      effect: "appear",
      trigger: "onEnter",
      delayMs: 300,
    });
    expect(out.steps[0]!.overrides["i1::cone"]).toEqual({ visible: true });
  });

  it("leaves a part that has its own entrance alone", () => {
    const def = makeDef({
      objects: [defObj("cone")],
      animations: [
        defAnim({
          id: "in",
          objectId: "cone",
          kind: "entrance",
          effect: "fade",
        }),
      ],
    });
    const out = expandOne(def, inst());
    expect(
      out.steps[0]!.animations.filter((a) => a.effect === "appear"),
    ).toHaveLength(0);
  });

  it("keeps a part the author hid hidden, and never reveals it", () => {
    const def = makeDef({ objects: [defObj("ghost", { visible: false })] });
    const out = expandOne(def, inst());
    expect(out.steps[0]!.overrides["i1::ghost"]).toEqual({ visible: false });
    expect(out.steps[0]!.animations).toHaveLength(0);
  });

  it("ends visible when the def's own entrance brings a hidden part on", () => {
    const def = makeDef({
      objects: [defObj("orb", { visible: false })],
      animations: [
        defAnim({
          id: "in",
          objectId: "orb",
          kind: "entrance",
          effect: "appear",
        }),
      ],
    });
    const out = expandOne(def, inst());
    expect(out.steps[0]!.overrides["i1::orb"]).toMatchObject({ visible: true });
  });
});

describe("expandPlan — an attack owns its own timing", () => {
  /** Two chained animations: the second follows the first by 500ms. */
  const chained = makeDef({
    objects: [defObj("o1")],
    animations: [
      defAnim({ id: "a1", objectId: "o1", durationMs: 500 }),
      defAnim({
        id: "a2",
        objectId: "o1",
        trigger: "afterPrevious",
        durationMs: 200,
      }),
    ],
  });

  it("flattens the def's chain onto absolute delays", () => {
    const out = expandOne(chained, inst());
    expect(animById(out, "i1::a1")).toMatchObject({
      trigger: "onEnter",
      delayMs: 0,
    });
    expect(animById(out, "i1::a2")).toMatchObject({
      trigger: "onEnter",
      delayMs: 500,
    });
  });

  it("shifts the whole bundle by startMs exactly once", () => {
    const out = expandOne(chained, inst({ startMs: 1000 }));
    // Not 1000 + 500 + 1000: the offset moves the attack, it doesn't compound
    // down the chain.
    expect(animById(out, "i1::a1").delayMs).toBe(1000);
    expect(animById(out, "i1::a2").delayMs).toBe(1500);
  });

  it("keeps a deferred animation's own trigger and delay", () => {
    const def = makeDef({
      objects: [defObj("o1")],
      animations: [
        defAnim({
          id: "hit",
          objectId: "o1",
          trigger: "onCollision",
          delayMs: 50,
        }),
      ],
    });
    const out = expandOne(def, inst({ startMs: 400 }));
    // It fires from the collision, not from the step — offsetting it would
    // delay the *reaction*.
    expect(animById(out, "i1::hit")).toMatchObject({
      trigger: "onCollision",
      delayMs: 50,
    });
  });

  it("keeps two attacks on one step from chaining into each other", () => {
    const plan = makePlan(
      [step()],
      [],
      [inst({ id: "i1" }), inst({ id: "i2" })],
    );
    const out = expandPlan(plan, { atk: chained });
    // i2's first animation still starts at 0 — it does not queue up behind i1.
    expect(animById(out, "i2::a1").delayMs).toBe(0);
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
    expect(animById(out, "i1::a1").durationMs).toBe(1200);
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
    expect(animById(out, "i1::a1").durationMs).toBe(500);
  });
});

describe("defToPlan / planToAttackContent", () => {
  it("lays the def out at its own size, centred on the authoring canvas", () => {
    const def = makeDef({ defaultSize: { w: 300, h: 200 } });
    const plan = defToPlan(def);

    expect(plan.background).toEqual({
      assetId: ATTACK_BOX_ASSET,
      width: ATTACK_AUTHORING_SIZE,
      height: ATTACK_AUTHORING_SIZE,
    });
    // What you drew is what you get: 300×200, centred on the 1000² canvas. The
    // author sees the attack life-size instead of typing its dimensions.
    expect(plan.objects[0]!.base).toMatchObject({
      x: 350,
      y: 400,
      w: 300,
      h: 200,
    });
    expect(plan.steps).toHaveLength(1);
  });

  it("shrink-wraps what was drawn: its extent becomes unit space", () => {
    // Drawn small, off in a corner of the canvas — the usual case.
    const drawn = defToPlan(makeDef({ objects: [] }));
    drawn.objects = [
      {
        id: "o1",
        type: "shape",
        shape: "circle",
        base: {
          x: 100,
          y: 200,
          w: 50,
          h: 80,
          rotation: 0,
          opacity: 1,
          z: 0,
          visible: true,
        },
      },
    ];

    const content = planToAttackContent(drawn, { name: "Wrapped" });
    // Stored spanning -1..1 exactly...
    expect(content.objects[0]!.base).toMatchObject({
      x: -1,
      y: -1,
      w: 2,
      h: 2,
    });
    // ...and remembering the size and proportions it was drawn at, so a fresh
    // copy doesn't arrive square.
    expect(content.defaultSize).toEqual({ w: 50, h: 80 });
  });

  it("wraps the whole sweep, not just where things start", () => {
    const drawn = defToPlan(makeDef({ objects: [] }));
    drawn.objects = [
      {
        id: "o1",
        type: "shape",
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
      },
    ];
    drawn.steps[0]!.overrides = { o1: { x: 300, y: 0 } };

    const content = planToAttackContent(drawn, { name: "Sweep" });
    // 0‥400 across, 0‥100 down: the rectangle covers everywhere it goes.
    expect(content.defaultSize).toEqual({ w: 400, h: 100 });
    expect(content.objects[0]!.base).toMatchObject({ x: -1, y: -1, w: 0.5 });
    expect(content.overrides["o1"]).toMatchObject({ x: 0.5 });
  });

  it("keeps the default rectangle for an attack with nothing in it", () => {
    const empty = defToPlan(makeDef({ objects: [] }));
    expect(planToAttackContent(empty, { name: "Empty" }).defaultSize).toEqual({
      w: 400,
      h: 400,
    });
  });

  it("round-trips a def's body, size and all", () => {
    const def = makeDef({
      defaultSize: { w: 300, h: 200 },
      objects: [defObj("o1", { x: -1, y: -1, w: 1, h: 2 })],
      overrides: { o1: { x: 0, y: -1 } },
      animations: [defAnim({ objectId: "o1", params: { toX: 0, toY: -1 } })],
    });

    const content = planToAttackContent(defToPlan(def), { name: "Renamed" });

    expect(content.name).toBe("Renamed");
    // Already shrink-wrapped, so a round trip is a no-op — editing an attack
    // and saving it unchanged must not drift.
    expect(content.defaultSize).toEqual({ w: 300, h: 200 });
    expect(content.objects[0]!.base).toMatchObject(def.objects[0]!.base);
    expect(content.overrides["o1"]).toMatchObject({ x: 0, y: -1 });
    expect(content.animations[0]!.params).toEqual({ toX: 0, toY: -1 });
  });
});

describe("expandPlan — result is a valid plan", () => {
  it("round-trips through the document schema", () => {
    const def = makeDef({
      objects: [defObj("c", { x: 0.5, y: 0.5 })],
      animations: [defAnim({ objectId: "c", params: { toX: 1, toY: 1 } })],
    });
    const plan = makePlan(
      [step({ id: "s1" }), step({ id: "s2" })],
      [],
      [inst()],
    );
    expect(() =>
      PlanSchema.parse(expandPlan(plan, { atk: def })),
    ).not.toThrow();
  });
});
