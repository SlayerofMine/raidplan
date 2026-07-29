import { describe, expect, it } from "vitest";
import {
  ATTACK_FIELD_NAMES,
  AttackBindingSchema,
  AttackInstanceSchema,
  AttackParamSchema,
  attackFieldKind,
  attackFieldSide,
  attackParamValue,
  attackSlots,
  IDENTITY_ATTACK_TRANSFORM,
  type AttackParam,
} from "../src/attack.js";
import {
  AttackDefSchema,
  PlanSchema,
  SlideSchema,
  makeEmptyPlan,
  makeFirstSlide,
  slideAttacks,
  type PlanObject,
} from "../src/plan.js";

const BACKGROUND = { assetId: "arena", width: 1600, height: 900 };

function object(id: string, over: Partial<PlanObject> = {}): PlanObject {
  return {
    id,
    type: "token",
    base: {
      x: 0,
      y: 0,
      w: 64,
      h: 64,
      rotation: 0,
      opacity: 1,
      z: 0,
      visible: true,
    },
    ...over,
  };
}

function param(over: Partial<AttackParam> = {}): AttackParam {
  return {
    name: "colour",
    label: "Colour",
    kind: "color",
    value: "#ff0000",
    targets: [{ on: "object", targetId: "obj_1", field: "tint" }],
    ...over,
  } as AttackParam;
}

describe("attack parameters", () => {
  it("accepts a parameter whose kind matches every field it drives", () => {
    expect(AttackParamSchema.safeParse(param()).success).toBe(true);
  });

  it("rejects a parameter bound to a field of a different kind, so the stamp can never write a colour into a duration", () => {
    const result = AttackParamSchema.safeParse(
      param({
        targets: [{ on: "anim", targetId: "anim_1", field: "durationMs" }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a default value that isn't of the parameter's own kind", () => {
    const result = AttackParamSchema.safeParse(
      param({
        kind: "number",
        value: "not a number",
        // A valid target, so the only thing wrong is the default itself.
        targets: [{ on: "anim", targetId: "anim_1", field: "durationMs" }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an object-side field claimed by an animation binding", () => {
    const result = AttackBindingSchema.safeParse({
      on: "anim",
      targetId: "obj_1",
      field: "tint",
    });
    expect(result.success).toBe(false);
  });

  it("gives every field a side and a kind, so no binding can name a field the stamp has no code for", () => {
    for (const field of ATTACK_FIELD_NAMES) {
      expect(["object", "anim"]).toContain(attackFieldSide(field));
      expect(attackFieldKind(field)).toBeTruthy();
    }
  });
});

describe("attackParamValue", () => {
  const colour = param();

  it("uses the author's default when the placement says nothing", () => {
    expect(attackParamValue(colour, {})).toBe("#ff0000");
  });

  it("uses the placement's own value when it has one", () => {
    expect(attackParamValue(colour, { colour: "#00ff00" })).toBe("#00ff00");
  });

  it("falls back to the default when the stored value is the wrong shape, so a hand-edited document still renders the attack", () => {
    expect(attackParamValue(colour, { colour: 42 })).toBe("#ff0000");
  });
});

describe("attackSlots", () => {
  it("returns the slot objects in authoring order — the order placement binds them", () => {
    const objects = [
      object("a"),
      object("b", { slotName: "the tank" }),
      object("c"),
      object("d", { slotName: "the healer" }),
    ];
    expect(attackSlots(objects).map((o) => o.id)).toEqual(["b", "d"]);
  });

  it("finds none in a definition that stands on its own", () => {
    expect(attackSlots([object("a"), object("b")])).toEqual([]);
  });
});

describe("the document schemas", () => {
  it("parses a v6 document — no attacks, no instances — unchanged, so no migration step is needed", () => {
    const v6 = {
      id: "p",
      title: "Old plan",
      raid: "",
      background: BACKGROUND,
      objects: [object("obj_1")],
      groups: {},
      slides: [{ id: "s1", states: {}, animations: [] }],
      schemaVersion: 6,
    };
    const parsed = PlanSchema.parse(v6);
    expect(parsed.attacks).toEqual([]);
    expect(slideAttacks(parsed.slides[0]!)).toEqual({});
  });

  it("reads an absent and an empty attackInstances as the same thing", () => {
    const bare = SlideSchema.parse({ id: "s", states: {}, animations: [] });
    const empty = SlideSchema.parse({
      id: "s",
      states: {},
      animations: [],
      attackInstances: {},
    });
    expect(slideAttacks(bare)).toEqual(slideAttacks(empty));
  });

  it("defaults an instance's recipe fields, so a partially written one still places as authored", () => {
    const instance = AttackInstanceSchema.parse({
      id: "atk_1",
      defId: "def_1",
      name: "Fireball",
      transform: IDENTITY_ATTACK_TRANSFORM,
    });
    expect(instance.timeScale).toBe(1);
    expect(instance.anchorDelayMs).toBe(0);
    expect(instance.values).toEqual({});
    expect(instance.slots).toEqual({});
    expect(instance.objectMap).toEqual({});
    expect(instance.animMap).toEqual({});
  });

  it("round-trips a plan carrying a definition and a placement of it", () => {
    const def = AttackDefSchema.parse({
      id: "def_1",
      name: "Fireball",
      source: "plan",
      objects: [object("obj_1"), object("slot_1", { slotName: "the tank" })],
      slide: makeFirstSlide(),
      params: [param()],
    });
    const plan = {
      ...makeEmptyPlan({ id: "p", background: BACKGROUND }),
      attacks: [def],
      slides: [
        {
          ...makeFirstSlide(),
          attackInstances: {
            atk_1: {
              id: "atk_1",
              defId: "def_1",
              name: "Fireball",
              transform: { tx: 10, ty: -5, rotationDeg: 90, sx: 2, sy: 2 },
              timeScale: 1.5,
              anchorDelayMs: 250,
              values: { colour: "#00ff00" },
              slots: { slot_1: "obj_player" },
              objectMap: { obj_1: "obj_stamped" },
              animMap: {},
            },
          },
        },
      ],
    };
    const parsed = PlanSchema.parse(plan);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(
      JSON.parse(
        JSON.stringify(PlanSchema.parse(JSON.parse(JSON.stringify(parsed)))),
      ),
    );
    expect(parsed.attacks[0]!.name).toBe("Fireball");
    expect(slideAttacks(parsed.slides[0]!).atk_1!.slots).toEqual({
      slot_1: "obj_player",
    });
  });
});
