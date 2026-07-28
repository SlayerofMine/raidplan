import { describe, expect, it } from "vitest";
import {
  ATTACK_AUTHORING_SIZE,
  ATTACK_BOX_ASSET,
  attackContentBox,
  attackFollow,
  attackNaturalMs,
  attackPlacement,
  attackSlots,
  attackSpanMs,
  slotsFilled,
  AttackDefSchema,
  attackIdsInPlan,
  ATTACK_END_SLIDE,
  defToPlan,
  expandPlan,
  planToAttackContent,
  selectionToAttackPlan,
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
  type Slide,
  type SlideState,
} from "../src/plan.js";
import { seedState } from "../src/resolve.js";

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

/**
 * A definition as it is *written* here (plan §19.2): its animations, and only
 * what its slide **changes** about each part.
 *
 * The document itself carries a complete {@link SlideState} per part, like every
 * slide in every plan — but a fixture that spelled all seven fields out for
 * every object would bury the one field a test is actually about. So the
 * cascade lives here, exactly as `demoPlan`'s authoring shape does for plans.
 */
type DefOver = Omit<Partial<AttackDef>, "slides"> & {
  animations?: Anim[];
  settles?: Record<string, Partial<SlideState>>;
};

const makeDef = ({
  animations = [],
  settles = {},
  ...over
}: DefOver = {}): AttackDef => {
  const objects = over.objects ?? [defObj("o1")];
  const states: Record<string, SlideState> = {};
  for (const o of objects) states[o.id] = { ...seedState(o), ...settles[o.id] };
  return {
    id: "atk",
    scope: { kind: "encounter", encounterId: "enc" },
    name: "Cone",
    version: 1,
    defaultSize: { w: 400, h: 400 },
    params: [],
    bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
    ...over,
    objects,
    slides: [{ id: ATTACK_END_SLIDE, name: "End", states, animations }],
  };
};

/**
 * The default instance covers (0,0)‥(200,200): centre (100,100), half-extents
 * 100. So unit (0,0) lands at (100,100) and unit (1,0) at (200,100).
 */
const inst = (over: Partial<AttackInstance> = {}): AttackInstance => ({
  id: "i1",
  attackId: "atk",
  slideId: "s1",
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  rotation: 0,
  startMs: 0,
  slots: {},
  args: {},
  ...over,
});

const slide = (over: Partial<Slide> = {}): Slide => ({
  id: "s1",
  states: {},
  animations: [],
  ...over,
});

const makePlan = (
  slides: Slide[],
  objects: PlanObject[] = [],
  attacks: AttackInstance[] = [],
): Plan => ({
  id: "p",
  title: "t",
  raid: "",
  background: { assetId: "arena", width: 1600, height: 900 },
  objects,
  attacks,
  groups: {},
  slides,
  schemaVersion: SCHEMA_VERSION,
});

/** The last object in the expanded plan — the one an attack just added. */
const lastObject = (plan: Plan) => plan.objects.at(-1)!;

/** One expanded animation, by its namespaced id. */
const animById = (plan: Plan, id: string, slideIndex = 0) =>
  plan.slides[slideIndex]!.animations.find((a) => a.id === id)!;

const expandOne = (def: AttackDef, instance: AttackInstance) =>
  expandPlan(makePlan([slide()], [], [instance]), { atk: def });

describe("AttackDefSchema", () => {
  const oneSlide = [{ id: "end", states: {}, animations: [] }];

  it("defaults version and placement hint", () => {
    const def = AttackDefSchema.parse({
      id: "a",
      scope: { kind: "encounter", encounterId: "e" },
      name: "n",
      objects: [],
      slides: oneSlide,
    });
    expect(def.version).toBe(1);
    expect(def.defaultSize).toEqual({ w: 400, h: 400 });
    expect(def.slides[0].states).toEqual({});
  });

  // The tuple is where §18.2's "a definition is exactly base state + one slide"
  // stopped being a comment (§19.2). A def with two slides is a def that has
  // grown a timeline of its own, which is what a *plan* is for.
  it("takes exactly one slide, never none and never two", () => {
    const def = (slides: unknown) =>
      AttackDefSchema.safeParse({
        id: "a",
        scope: { kind: "encounter", encounterId: "e" },
        name: "n",
        objects: [],
        slides,
      }).success;
    expect(def(oneSlide)).toBe(true);
    expect(def([])).toBe(false);
    expect(def([...oneSlide, { id: "b", states: {}, animations: [] }])).toBe(
      false,
    );
  });
});

describe("attackIdsInPlan", () => {
  it("collects distinct attack ids across the plan", () => {
    const plan = makePlan(
      [slide({ id: "s0" }), slide({ id: "s1" })],
      [],
      [
        inst({ attackId: "a" }),
        inst({ attackId: "b" }),
        inst({ attackId: "a", slideId: "s1" }),
      ],
    );
    expect(attackIdsInPlan(plan).sort()).toEqual(["a", "b"]);
  });

  it("is empty for a plan with no attacks", () => {
    expect(attackIdsInPlan(makePlan([slide()]))).toEqual([]);
  });
});

describe("expandPlan — the common case is free", () => {
  it("returns the very same plan when nothing has attacks", () => {
    const plan = makePlan([slide()]);
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

  it("bounds visibility to the instance's slide", () => {
    const plan = makePlan(
      [slide({ id: "s1" }), slide({ id: "s2" })],
      [],
      [inst()],
    );
    const out = expandPlan(plan, { atk: makeDef() });
    // Every slide *opens* with the part hidden — a slide states where things
    // start, and an attack starts un-fired. What makes it happen on s1 and not
    // on s2 is that only s1 carries its animations.
    expect(out.slides[0]!.states["i1::o1"]).toMatchObject({ visible: false });
    expect(out.slides[1]!.states["i1::o1"]).toMatchObject({ visible: false });
    expect(out.slides[0]!.animations.map((a) => a.objectId)).toContain(
      "i1::o1",
    );
    expect(out.slides[1]!.animations).toEqual([]);
  });

  it("is present on its own slide when that's the only slide there is", () => {
    const out = expandOne(makeDef(), inst());
    expect(out.slides).toHaveLength(1);
    expect(out.slides[0]!.states["i1::o1"]).toBeDefined();
    expect(out.slides[0]!.animations.length).toBeGreaterThan(0);
  });

  it("skips an instance whose def is missing, leaving the rest renderable", () => {
    const out = expandPlan(
      makePlan([slide()], [], [inst({ attackId: "ghost" })]),
      {},
    );
    expect(out.objects).toEqual([]);
    expect(out.attacks).toEqual([]);
  });

  it("skips an attack that was switched off", () => {
    const out = expandPlan(
      makePlan([slide({ id: "s1" })], [], [inst({ visible: false })]),
      { atk: makeDef() },
    );
    // Still in the document, just not happening — the placement survives to be
    // switched back on.
    expect(out.objects).toEqual([]);
    expect(out.slides[0]!.animations).toEqual([]);
  });

  it("skips an instance whose slide has been deleted", () => {
    const out = expandPlan(
      makePlan([slide({ id: "s1" })], [], [inst({ slideId: "gone" })]),
      { atk: makeDef() },
    );
    expect(out.objects).toEqual([]);
  });

  it("keeps two instances of one def from colliding", () => {
    const plan = makePlan(
      [slide()],
      [],
      [inst({ id: "i1" }), inst({ id: "i2" })],
    );
    const out = expandPlan(plan, { atk: makeDef() });
    const ids = out.objects.map((o) => o.id);
    expect(ids).toContain("i1::o1");
    expect(ids).toContain("i2::o1");
  });

  it("slots the attack into the board's stacking order", () => {
    const under = defObj("floor");
    under.base.z = 0;
    const over = defObj("token");
    over.base.z = 2;
    const plan = makePlan(
      [slide()],
      [under, over],
      [inst({ z: 1 })], // between them
    );
    const out = expandPlan(plan, { atk: makeDef() });

    // A renderer walks the array, so the array is the draw order: the attack's
    // part sits under the token standing on it.
    expect(out.objects.map((o) => o.id)).toEqual(["floor", "i1::o1", "token"]);
  });

  it("puts an attack with no place in the stack on top", () => {
    const plan = makePlan([slide()], [defObj("token")], [inst()]);
    const out = expandPlan(plan, { atk: makeDef() });
    expect(out.objects.map((o) => o.id).at(-1)).toBe("i1::o1");
  });

  it("preserves the plan's own objects and slide animations", () => {
    const own = defObj("boss");
    const ownAnim = defAnim({ id: "own", objectId: "boss" });
    const def = makeDef({ animations: [defAnim({ objectId: "o1" })] });
    const plan = makePlan([slide({ animations: [ownAnim] })], [own], [inst()]);
    const out = expandPlan(plan, { atk: def });
    expect(out.objects[0]).toBe(own);
    expect(out.slides[0]!.animations[0]).toBe(ownAnim);
    // own + the def's, + the implicit entrance that reveals the attack.
    expect(out.slides[0]!.animations).toHaveLength(3);
  });
});

describe("expandPlan — end-state overrides", () => {
  it("hands the def's end state to the animation meant to reach it", () => {
    // A half-width part that slides across: its life spans unit space, so the
    // rectangle covers the whole sweep.
    const def = makeDef({
      objects: [defObj("c", { x: -1, y: -1, w: 1, h: 2 })],
      settles: { c: { x: 0 } },
      animations: [defAnim({ id: "m", objectId: "c", effect: "move" })],
    });
    const out = expandOne(def, inst());
    // A def is authored as two states; a plan's animations state their own
    // targets. `expandInstance` is the seam that converts one into the other,
    // so the move now carries the destination the override described.
    expect(animById(out, "i1::m").params).toMatchObject({ toX: 100, toY: 0 });
    // And the slide opens where the part starts, not where it ends up.
    expect(out.slides[0]!.states["i1::c"]).toMatchObject({ x: 0, y: 0 });
  });

  it("honours a def end state that hides the object (a disappear)", () => {
    const def = makeDef({
      objects: [defObj("c")],
      settles: { c: { visible: false } },
    });
    const out = expandOne(def, inst());
    expect(out.slides[0]!.states["i1::c"]).toMatchObject({ visible: false });
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
    const anim = out.slides[0]!.animations.find((a) => a.id === "i1::hit")!;
    expect(anim.collideWith).toEqual(["i1::tank"]);
    expect(out.objects.find((o) => o.id === "i1::tether")).toMatchObject({
      fromId: "i1::orb",
      toId: "i1::tank",
    });
  });
});

describe("expandPlan — an attack shows itself", () => {
  /**
   * Materialising an attack's parts hidden is what keeps them off the slides
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
    // The `appear` is what reveals it: the slide opens with it hidden.
    expect(out.slides[0]!.states["i1::cone"]).toMatchObject({ visible: false });
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
      out.slides[0]!.animations.filter((a) => a.effect === "appear"),
    ).toHaveLength(0);
  });

  it("keeps a part the author hid hidden, and never reveals it", () => {
    const def = makeDef({ objects: [defObj("ghost", { visible: false })] });
    const out = expandOne(def, inst());
    expect(out.slides[0]!.states["i1::ghost"]).toMatchObject({
      visible: false,
    });
    expect(out.slides[0]!.animations).toHaveLength(0);
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
    // Hidden at the slide's start; the def's own entrance brings it on.
    expect(out.slides[0]!.states["i1::orb"]).toMatchObject({ visible: false });
    expect(animById(out, "i1::in")).toMatchObject({ effect: "appear" });
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
    // It fires from the collision, not from the slide — offsetting it would
    // delay the *reaction*.
    expect(animById(out, "i1::hit")).toMatchObject({
      trigger: "onCollision",
      delayMs: 50,
    });
  });

  it("keeps two attacks on one slide from chaining into each other", () => {
    const plan = makePlan(
      [slide()],
      [],
      [inst({ id: "i1" }), inst({ id: "i2" })],
    );
    const out = expandPlan(plan, { atk: chained });
    // i2's first animation still starts at 0 — it does not queue up behind i1.
    expect(animById(out, "i2::a1").delayMs).toBe(0);
  });
});

describe("expandPlan — placeholders", () => {
  /** A definition that tethers something of its own to a plan object. */
  const tethered = makeDef({
    objects: [
      defObj("orb"),
      { id: "victim", type: "placeholder", base: base() },
      {
        id: "leash",
        type: "tether",
        fromId: "orb",
        toId: "victim",
        base: base(),
      },
    ],
  });

  it("lists the holes a plan has to fill", () => {
    expect(attackSlots(tethered).map((s) => s.id)).toEqual(["victim"]);
    expect(attackSlots(makeDef())).toEqual([]);
  });

  it("knows when it can be placed", () => {
    expect(slotsFilled(tethered, {})).toBe(false);
    expect(slotsFilled(tethered, { victim: "tank" })).toBe(true);
    expect(slotsFilled(makeDef(), {})).toBe(true);
  });

  it("points the tether at the plan's own object", () => {
    const out = expandOne(tethered, inst({ slots: { victim: "tank" } }));
    // The far end is the *plan's* id, un-namespaced: it is that object, not a
    // copy of it — which is the whole point, and was impossible before.
    expect(out.objects.find((o) => o.id === "i1::leash")).toMatchObject({
      fromId: "i1::orb",
      toId: "tank",
    });
  });

  it("never materialises the placeholder itself", () => {
    const out = expandOne(tethered, inst({ slots: { victim: "tank" } }));
    // The plan's object is already on the board; a second copy would be a lie.
    expect(out.objects.map((o) => o.id)).not.toContain("i1::victim");
  });

  it("follows the placeholder through a collision target", () => {
    const def = makeDef({
      objects: [
        defObj("orb"),
        { id: "who", type: "placeholder", base: base() },
      ],
      animations: [
        defAnim({
          id: "hit",
          objectId: "orb",
          trigger: "onCollision",
          collideWith: ["who"],
        }),
      ],
    });
    const out = expandOne(def, inst({ slots: { who: "healer" } }));
    expect(animById(out, "i1::hit").collideWith).toEqual(["healer"]);
  });

  it("takes no part in the attack's extent", () => {
    // Whatever fills it could be anywhere on the board, so letting it stretch
    // the rectangle would make the rectangle meaningless.
    const spread = makeDef({
      objects: [
        defObj("orb"),
        { id: "far", type: "placeholder", base: base({ x: 8, y: 8 }) },
      ],
    });
    const out = expandOne(spread, inst());
    expect(out.objects.find((o) => o.id === "i1::orb")!.base).toMatchObject({
      x: 0,
      y: 0,
      w: 200,
      h: 200,
    });
  });

  it("leaves an unfilled hole inert rather than dangling into nothing", () => {
    const out = expandOne(tethered, inst());
    const leash = out.objects.find((o) => o.id === "i1::leash")!;
    // Namespaced, so it points at an object that doesn't exist — and a tether
    // with a missing end simply doesn't draw.
    expect(leash.toId).toBe("i1::victim");
    expect(out.objects.map((o) => o.id)).not.toContain("i1::victim");
  });
});

describe("attackPlacement — an attack that follows the board", () => {
  /**
   * A frontal: cast from the middle of its left edge, pointing right, hanging
   * off the "boss" hole and aimed at the "target" one.
   *
   * The origin and direction are the definition's *own* geometry now — two
   * numbers and an angle — rather than being read off where a pair of ghost
   * placeholders happened to be dragged. The placeholders remain only for what
   * they are actually for: holes the plan fills.
   */
  const frontal = makeDef({
    defaultSize: { w: 200, h: 200 },
    objects: [
      defObj("cone"),
      { id: "boss", type: "placeholder", base: base() },
      { id: "target", type: "placeholder", base: base() },
    ],
    ox: 0,
    oy: 0.5,
    dir: 0,
    follow: { pin: "boss", aim: "target" },
  });

  const at =
    (points: Record<string, { x: number; y: number }>) => (id: string) =>
      points[id] ?? null;

  it("leaves an attack that follows nothing where the plan put it", () => {
    expect(attackPlacement(makeDef(), inst(), () => ({ x: 0, y: 0 }))).toBe(
      null,
    );
  });

  it("says nothing when what it follows isn't on the board", () => {
    // The stored rectangle stands rather than snapping to the origin.
    expect(attackPlacement(frontal, inst(), () => null)).toBe(null);
    expect(
      attackPlacement(frontal, inst({ slots: { boss: "b" } }), () => null),
    ).toBe(null);
  });

  it("hangs the attack off the object filling its pin hole", () => {
    const placed = attackPlacement(
      frontal,
      inst({ slots: { boss: "b" } }),
      at({ b: { x: 500, y: 500 } }),
    )!;
    // The origin is the rectangle's left edge, so the rectangle starts there.
    expect(placed.x).toBeCloseTo(500);
    expect(placed.y).toBeCloseTo(400);
  });

  it("turns to face its target", () => {
    const placed = attackPlacement(
      frontal,
      inst({ slots: { boss: "b", target: "t" } }),
      // The target is straight down from the boss: a quarter turn.
      at({ b: { x: 500, y: 500 }, t: { x: 500, y: 900 } }),
    )!;
    expect(placed.rotation).toBeCloseTo(90);
  });

  it("re-aims when the target moves — that's the whole point", () => {
    const instance = inst({ slots: { boss: "b", target: "t" } });
    const east = attackPlacement(
      frontal,
      instance,
      at({ b: { x: 500, y: 500 }, t: { x: 900, y: 500 } }),
    )!;
    const west = attackPlacement(
      frontal,
      instance,
      at({ b: { x: 500, y: 500 }, t: { x: 100, y: 500 } }),
    )!;
    expect(east.rotation).toBeCloseTo(0);
    expect(Math.abs(west.rotation)).toBeCloseTo(180);
  });

  it("keeps its own size — reach belongs to the ability, not the distance", () => {
    const near = attackPlacement(
      frontal,
      inst({ slots: { boss: "b", target: "t" } }),
      at({ b: { x: 500, y: 500 }, t: { x: 600, y: 500 } }),
    )!;
    const far = attackPlacement(
      frontal,
      inst({ slots: { boss: "b", target: "t" } }),
      at({ b: { x: 500, y: 500 }, t: { x: 5000, y: 500 } }),
    )!;
    expect(near.x).toBeCloseTo(far.x);
    expect(near.y).toBeCloseTo(far.y);
  });

  it("stays hung off the origin however it is turned", () => {
    const placed = attackPlacement(
      frontal,
      inst({ slots: { boss: "b", target: "t" } }),
      at({ b: { x: 500, y: 500 }, t: { x: 500, y: 900 } }),
    )!;
    // A quarter turn about the boss: the rectangle swings round to sit below
    // him, and the point it hangs from stays put.
    expect(placed.rotation).toBeCloseTo(90);
    // Origin = (x,y) + R(90)·(0·200, 0.5·200) = (x − 100, y) — back on the boss.
    expect(placed.x - 100).toBeCloseTo(500);
    expect(placed.y).toBeCloseTo(500);
  });

  it("an instance's own follow beats the definition's", () => {
    const placed = attackPlacement(
      frontal,
      inst({
        slots: { boss: "b", target: "t" },
        follow: { pin: "other" },
      }),
      at({
        b: { x: 500, y: 500 },
        t: { x: 500, y: 900 },
        other: { x: 10, y: 10 },
      }),
    )!;
    // Pinned to what the planner said, and not turned, because their follow
    // said nothing about aiming.
    expect(placed.x).toBeCloseTo(10);
    expect(placed.rotation).toBeCloseTo(0);
  });

  it("an instance's origin overrides the definition's", () => {
    const placed = attackPlacement(
      frontal,
      inst({ slots: { boss: "b" }, ox: 0.5, oy: 0.5 }),
      at({ b: { x: 500, y: 500 } }),
    )!;
    // Hung from the middle now, so the rectangle straddles the boss.
    expect(placed.x).toBeCloseTo(400);
    expect(placed.y).toBeCloseTo(400);
  });
});

describe("attackFollow — resolving a definition's holes", () => {
  const frontal = makeDef({ follow: { pin: "boss", aim: "target" } });

  it("maps the definition's placeholder ids through the instance's slots", () => {
    expect(
      attackFollow(frontal, inst({ slots: { boss: "b", target: "t" } })),
    ).toEqual({ pin: "b", aim: "t" });
  });

  it("drops the half nobody filled rather than following a hole", () => {
    expect(attackFollow(frontal, inst({ slots: { boss: "b" } }))).toEqual({
      pin: "b",
    });
  });

  it("is undefined when the definition follows nothing", () => {
    expect(attackFollow(makeDef(), inst())).toBeUndefined();
  });

  it("takes the instance's own follow as-is — those are plan ids already", () => {
    expect(
      attackFollow(
        frontal,
        inst({ slots: { boss: "b" }, follow: { aim: "z" } }),
      ),
    ).toEqual({ aim: "z" });
  });
});

describe("expandPlan — a stretched attack", () => {
  /** 500ms, then 200ms after it: 700ms of attack. */
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

  it("reports the definition's own length", () => {
    expect(attackNaturalMs(chained)).toBe(700);
    expect(attackSpanMs(chained, inst())).toBe(700);
  });

  it("plays at the definition's speed when the plan says nothing", () => {
    const out = expandOne(chained, inst());
    expect(animById(out, "i1::a1").durationMs).toBe(500);
    expect(animById(out, "i1::a2").delayMs).toBe(500);
  });

  it("stretches every part in proportion, so it just runs slower", () => {
    const out = expandOne(chained, inst({ durationMs: 1400 }));
    // Twice as long: everything takes twice as long and starts twice as late,
    // in the same order — it is not re-authored, only slowed down.
    expect(animById(out, "i1::a1").durationMs).toBe(1000);
    expect(animById(out, "i1::a2").durationMs).toBe(400);
    expect(animById(out, "i1::a2").delayMs).toBe(1000);
    expect(attackSpanMs(chained, inst({ durationMs: 1400 }))).toBe(1400);
  });

  it("compresses just as happily", () => {
    const out = expandOne(chained, inst({ durationMs: 350 }));
    expect(animById(out, "i1::a1").durationMs).toBe(250);
    expect(animById(out, "i1::a2").delayMs).toBe(250);
  });

  it("stacks with the start offset without scaling it", () => {
    // `startMs` says when the attack fires within the slide; stretching says how
    // long it then takes. Scaling the offset too would couple the two.
    const out = expandOne(chained, inst({ startMs: 300, durationMs: 1400 }));
    expect(animById(out, "i1::a1").delayMs).toBe(300);
    expect(animById(out, "i1::a2").delayMs).toBe(1300);
  });

  it("measures the stretch against a parameter-set duration, not the authored one", () => {
    const def = makeDef({
      objects: [defObj("o1")],
      animations: [defAnim({ id: "a1", objectId: "o1", durationMs: 500 })],
      params: [{ key: "speed", label: "Duration", type: "number" }],
      bindings: {
        collideWith: {},
        durationMs: { a1: "speed" },
        delayMs: {},
        tint: {},
      },
    });
    // The plan says the part runs 1000ms, then the whole attack is stretched to
    // 2000ms: 2×, not 4×.
    const out = expandOne(
      def,
      inst({ args: { speed: 1000 }, durationMs: 2000 }),
    );
    expect(animById(out, "i1::a1").durationMs).toBe(2000);
  });

  it("leaves an attack with no animations alone rather than dividing by zero", () => {
    const out = expandOne(
      makeDef({ animations: [] }),
      inst({ durationMs: 900 }),
    );
    expect(attackNaturalMs(makeDef({ animations: [] }))).toBe(0);
    // Only the implicit entrance, still instant.
    expect(out.slides[0]!.animations.every((a) => a.durationMs === 0)).toBe(
      true,
    );
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
        delayMs: {},
        tint: {},
      },
      ...over,
    });

  it("takes collision targets from the plan, un-namespaced", () => {
    const out = expandOne(catchable(), inst({ args: { victims: ["tank-1"] } }));
    const anim = out.slides[0]!.animations.find((a) => a.id === "i1::caught")!;
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
    const anim = out.slides[0]!.animations.find((a) => a.id === "i1::caught")!;
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
    const anim = out.slides[0]!.animations.find((a) => a.id === "i1::hit")!;
    expect(anim.collideWith).toEqual(["i1::tank"]);
  });

  it("feeds every place it was pointed at, from one answer", () => {
    // The whole reason a parameter is named: "the tanks" is decided once and
    // used by everything in the attack that needs to know.
    const def = makeDef({
      objects: [defObj("orb"), defObj("cone")],
      animations: [
        defAnim({
          id: "hitA",
          objectId: "orb",
          trigger: "onCollision",
        }),
        defAnim({
          id: "hitB",
          objectId: "cone",
          trigger: "onCollision",
        }),
      ],
      params: [{ key: "tanks", label: "Tanks", type: "objectRefs" }],
      bindings: {
        collideWith: { hitA: "tanks", hitB: "tanks" },
        durationMs: {},
        delayMs: {},
        tint: {},
      },
    });
    const out = expandOne(def, inst({ args: { tanks: ["t1", "t2"] } }));
    expect(animById(out, "i1::hitA").collideWith).toEqual(["t1", "t2"]);
    expect(animById(out, "i1::hitB").collideWith).toEqual(["t1", "t2"]);
  });

  it("supplies a delay, and the chain lays out around it", () => {
    const def = makeDef({
      objects: [defObj("orb")],
      animations: [
        defAnim({ id: "a1", objectId: "orb", durationMs: 500 }),
        defAnim({
          id: "a2",
          objectId: "orb",
          trigger: "afterPrevious",
          durationMs: 100,
        }),
      ],
      params: [{ key: "cast", label: "Cast time", type: "number" }],
      bindings: {
        collideWith: {},
        durationMs: {},
        delayMs: { a1: "cast" },
        tint: {},
      },
    });
    const out = expandOne(def, inst({ args: { cast: 300 } }));
    expect(animById(out, "i1::a1").delayMs).toBe(300);
    // What follows it moves too — the plan's answer is part of the timing.
    expect(animById(out, "i1::a2").delayMs).toBe(800);
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
        delayMs: {},
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
        delayMs: {},
        tint: { orb: "colour" },
      },
    });
    const out = expandOne(def, inst());
    expect(lastObject(out).base.tint).toBe("#123456");
    expect(animById(out, "i1::a1").durationMs).toBe(500);
  });
});

describe("attackContentBox — parts that follow other parts", () => {
  /** An anchor filling (0,0)‥(100,100), so its centre is (50,50). */
  const anchor = (over: Partial<ObjectBase> = {}): PlanObject => ({
    ...defObj("anchor"),
    base: base({ x: 0, y: 0, w: 100, h: 100, ...over }),
  });

  /** A 20² part authored far away, so a stale reading is unmissable. */
  const follower = (over: Partial<ObjectBase> = {}): PlanObject => ({
    ...defObj("part"),
    base: base({ x: 1000, y: 1000, w: 20, h: 20, ...over }),
    follow: { pin: "anchor" },
  });

  const boxOf = (
    objects: PlanObject[],
    over: {
      settles?: Record<string, Partial<SlideState>>;
      animations?: Anim[];
    } = {},
  ) => attackContentBox(makeDef({ objects, ...over }));

  it("measures a pinned part where the pin puts it, not where it was drawn", () => {
    // Centred origin, so the pin lands the part's middle on (50,50): 40‥60.
    // Read from `base` instead and the box would run out to 1020.
    expect(boxOf([anchor(), follower()])).toEqual({
      cx: 50,
      cy: 50,
      hx: 50,
      hy: 50,
    });
  });

  it("follows the origin the part hangs from, not its top-left", () => {
    // ox/oy of 3 puts the origin 60px past the corner, so pinning it to (50,50)
    // swings the body back to -10‥10 and the attack grows on that side.
    expect(boxOf([anchor(), follower({ ox: 3, oy: 3 })])).toEqual({
      cx: 45,
      cy: 45,
      hx: 55,
      hy: 55,
    });
  });

  it("is unmoved by sliding the origin handle across a fixed pin", () => {
    // `slidePinnedOrigin` walks the box one way and the fraction the other,
    // leaving the origin exactly where it was — so the artwork doesn't move and
    // neither may the bounds. This is the pair of readings it produces.
    const before = boxOf([anchor(), follower({ ox: 0.5, oy: 0.5 })]);
    const after = boxOf([anchor(), follower({ x: 990, y: 990, ox: 1, oy: 1 })]);
    expect(after).toEqual(before);
  });

  it("carries a pinned part along everywhere its anchor goes", () => {
    // The anchor flies 500 right; whatever is pinned to it makes the trip too,
    // so the footprint has to cover the whole journey.
    expect(
      boxOf([anchor(), follower()], {
        animations: [
          defAnim({ objectId: "anchor", params: { toX: 500, toY: 0 } }),
        ],
      }),
    ).toEqual({ cx: 300, cy: 50, hx: 300, hy: 50 });
  });

  it("turns a part that aims, and covers where that swings it", () => {
    const target: PlanObject = {
      ...defObj("target"),
      base: base({ x: -5, y: 195, w: 10, h: 10 }),
    };
    // A 100×10 bar hanging from its left edge, aimed at something 200 below:
    // it turns a quarter turn and sweeps down to y=100.
    const bar: PlanObject = {
      ...defObj("bar"),
      base: base({ x: 0, y: -5, w: 100, h: 10, ox: 0, oy: 0.5 }),
      follow: { aim: "target" },
    };
    const box = boxOf([bar, target])!;
    // A quarter turn goes through a sine, so compare to within rounding.
    expect(box.cx).toBeCloseTo(0);
    expect(box.cy).toBeCloseTo(102.5);
    expect(box.hx).toBeCloseTo(5);
    expect(box.hy).toBeCloseTo(102.5);
  });

  it("leaves a part alone when what it follows isn't in the attack", () => {
    // A definition can follow one of the *plan's* objects through a
    // placeholder; there's no answer here, so the stored placement stands.
    const stray = { ...follower(), follow: { pin: "somewhere-else" } };
    expect(boxOf([anchor(), stray])).toEqual({
      cx: 510,
      cy: 510,
      hx: 510,
      hy: 510,
    });
  });

  it("settles a ring of follows instead of chasing it", () => {
    const a: PlanObject = { ...anchor(), follow: { pin: "part" } };
    const b = follower();
    expect(boxOf([a, b])).not.toBeNull();
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
    // Two slides, not one: a def is a start shape and the end its animations
    // reach, which the designer shows as Layout and Animate.
    expect(plan.slides).toHaveLength(2);
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
    // Where the End slide leaves it — a def's `overrides` are read back as the
    // difference between the two slides.
    drawn.slides[1]!.states = {
      o1: {
        x: 300,
        y: 0,
        w: 100,
        h: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
      },
    };

    const content = planToAttackContent(drawn, { name: "Sweep" });
    // 0‥400 across, 0‥100 down: the rectangle covers everywhere it goes.
    expect(content.defaultSize).toEqual({ w: 400, h: 100 });
    expect(content.objects[0]!.base).toMatchObject({ x: -1, y: -1, w: 0.5 });
    expect(content.slides[0].states["o1"]).toMatchObject({ x: 0.5 });
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
      settles: { o1: { x: 0, y: -1 } },
      animations: [defAnim({ objectId: "o1", params: { toX: 0, toY: -1 } })],
    });

    const content = planToAttackContent(defToPlan(def), { name: "Renamed" });

    expect(content.name).toBe("Renamed");
    // Already shrink-wrapped, so a round trip is a no-op — editing an attack
    // and saving it unchanged must not drift.
    expect(content.defaultSize).toEqual({ w: 300, h: 200 });
    expect(content.objects[0]!.base).toMatchObject(def.objects[0]!.base);
    expect(content.slides[0].states["o1"]).toMatchObject({ x: 0, y: -1 });
    expect(content.slides[0].animations[0]!.params).toEqual({
      toX: 0,
      toY: -1,
    });
  });
});

describe("expandPlan — result is a valid plan", () => {
  it("round-trips through the document schema", () => {
    const def = makeDef({
      objects: [defObj("c", { x: 0.5, y: 0.5 })],
      animations: [defAnim({ objectId: "c", params: { toX: 1, toY: 1 } })],
    });
    const plan = makePlan(
      [slide({ id: "s1" }), slide({ id: "s2" })],
      [],
      [inst()],
    );
    expect(() =>
      PlanSchema.parse(expandPlan(plan, { atk: def })),
    ).not.toThrow();
  });
});

describe("selectionToAttackPlan — the assembly is already the attack (§19.3)", () => {
  const at = (x: number, y: number): SlideState => ({
    x,
    y,
    w: 100,
    h: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
  });

  const planObj = (id: string, over: Partial<PlanObject> = {}): PlanObject => ({
    id,
    type: "shape",
    shape: "circle",
    base: base({ x: 0, y: 0, w: 100, h: 100 }),
    ...over,
  });

  /** A boss, and two circles the author has grouped into a cone. */
  const board = (over: Partial<Slide> = {}) =>
    makePlan(
      [
        slide({
          id: "s0",
          states: {
            boss: at(0, 0),
            a: at(100, 0),
            b: at(200, 0),
          },
          ...over,
        }),
      ],
      [
        planObj("boss"),
        planObj("a", { groupId: "g1" }),
        planObj("b", { groupId: "g1" }),
      ],
    );

  const saved = (plan: Plan, ids: string[]) =>
    selectionToAttackPlan(plan, ids, 0);

  it("takes the selected objects, in document order, without their group", () => {
    const { plan } = saved(board(), ["b", "a"]);
    // Document order rather than selection order: an attack's parts keep the
    // stacking they were drawn in.
    expect(plan.objects.map((o) => o.id)).toEqual(["a", "b"]);
    // The plan's group is not the attack's: once placed, the instance groups
    // its own parts.
    expect(plan.objects.every((o) => o.groupId === undefined)).toBe(true);
  });

  it("turns a reference out of the selection into a hole the plan fills", () => {
    const plan = board();
    plan.objects[1] = planObj("a", { groupId: "g1", follow: { pin: "boss" } });
    const out = saved(plan, ["a", "b"]).plan;

    // "Leash this to the boss" cannot come along — the boss isn't part of what
    // is being saved — but "one end of this is something you'll nominate" is
    // exactly what a placeholder says (§18.14).
    const holes = out.objects.filter((o) => o.type === "placeholder");
    expect(holes).toHaveLength(1);
    expect(out.objects.find((o) => o.id === "a")?.follow).toEqual({
      pin: holes[0]!.id,
    });
  });

  it("makes one hole per outside object, however many point at it", () => {
    const plan = board();
    plan.objects[1] = planObj("a", { follow: { pin: "boss" } });
    plan.objects[2] = planObj("b", { follow: { aim: "boss" } });
    const out = saved(plan, ["a", "b"]).plan;
    expect(out.objects.filter((o) => o.type === "placeholder")).toHaveLength(1);
  });

  it("carries the animations of what it took, and no others", () => {
    const plan = board({
      animations: [
        defAnim({ id: "mine", objectId: "a" }),
        defAnim({ id: "theirs", objectId: "boss" }),
      ],
    });
    const { plan: out } = saved(plan, ["a", "b"]);
    expect(out.slides[1]!.animations.map((a) => a.id)).toEqual(["mine"]);
  });

  it("drops a collision target outside the selection, and says so", () => {
    const plan = board({
      animations: [
        defAnim({ id: "hit", objectId: "a", collideWith: ["boss", "b"] }),
      ],
    });
    const { plan: out, leftBehind } = saved(plan, ["a", "b"]);
    // A definition can't name one of the plan's objects except through a
    // parameter (§18.4), so the boss is dropped rather than silently rewired —
    // and the author is told, so they can declare one.
    expect(out.slides[1]!.animations[0]!.collideWith).toEqual(["b"]);
    expect(leftBehind.collideWith).toEqual(["boss"]);
  });

  it("opens on the same layout it settles in", () => {
    // A plan's animations already state their own targets, so there is no
    // settled state to recover and nothing is lost by the two agreeing.
    const { plan } = saved(board(), ["a", "b"]);
    expect(plan.slides[0]!.states).toEqual(plan.slides[1]!.states);
    expect(plan.slides[0]!.animations).toEqual([]);
  });

  it("is a definition once it has been through unit space", () => {
    const { plan } = saved(board(), ["a", "b"]);
    const content = planToAttackContent(plan, { name: "Cone" });
    // 100..300 across, 0..100 down — the selection's own extent becomes -1..1.
    expect(content.defaultSize).toEqual({ w: 200, h: 100 });
    expect(content.objects[0]!.base).toMatchObject({ x: -1, y: -1 });
  });
});
