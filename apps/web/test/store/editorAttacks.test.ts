import { beforeEach, describe, expect, it } from "vitest";
import { attackIdsInPlan, SCHEMA_VERSION } from "@raidplan/shared";
import {
  boardStack,
  clearHistory,
  useEditorStore,
} from "../../src/store/editorStore";
import { pickPlanDoc, sameDocument } from "../../src/store/planSerialization";

/**
 * Placed attacks (plan §17, remodelled in §18.3). A plan stores only instances;
 * the store's job is to put them on the board, say which slide fires them,
 * retune them, and round-trip them through the serialized document.
 */
const state = () => useEditorStore.getState();

beforeEach(() => {
  state().reset();
  clearHistory();
});

describe("addAttack", () => {
  it("drops an instance on the board with sane defaults", () => {
    const slideId = state().addSlide();
    const id = state().addAttack("atk1", { x: 400, y: 300 });

    expect(state().attacks).toHaveLength(1);
    // Centred on the drop point, at the def's default size (400 by default).
    expect(state().attacks[0]).toMatchObject({
      id,
      attackId: "atk1",
      slideId,
      x: 200,
      y: 100,
      w: 400,
      h: 400,
      rotation: 0,
      startMs: 0,
    });
  });

  it("selects what it just placed, so it can be dragged straight away", () => {
    state().addSlide();
    const id = state().addAttack("atk1", { x: 0, y: 0 });
    expect(state().selectedAttackIds).toEqual([id]);
  });

  it("hands the selection over when an object is made next", () => {
    state().addSlide();
    state().addAttack("atk1", { x: 0, y: 0 });
    const object = state().addPrimitive("shape", "circle");

    // A selection is objects *or* attacks, never both — the properties panel
    // has to know which it is looking at.
    expect(state().selectedIds).toEqual([object]);
    expect(state().selectedAttackIds).toEqual([]);
  });

  it("fires on the slide being edited", () => {
    const second = state().addSlide();
    state().selectSlide(1);
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    expect(state().attacks.find((a) => a.id === id)!.slideId).toBe(second);
  });

  it("always has a slide to fire on — a plan can't have none", () => {
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    expect(state().slides).toHaveLength(1);
    expect(state().attacks.find((a) => a.id === id)!.slideId).toBe(
      state().slides[0]!.id,
    );
  });

  it("keeps several instances of one attack apart", () => {
    state().addSlide();
    const a = state().addAttack("atk1", { x: 1, y: 1 });
    const b = state().addAttack("atk1", { x: 2, y: 2 });
    expect(a).not.toBe(b);
    expect(state().attacks).toHaveLength(2);
  });
});

describe("addAttack — placeholders", () => {
  /** A definition with one hole in it, for the plan to fill. */
  const withSlot = (id = "atkSlot") => {
    state().setAttackDefs({
      [id]: {
        id,
        encounterId: "enc",
        name: "Frontal",
        version: 1,
        defaultSize: { w: 100, h: 100 },
        objects: [
          {
            id: "victim",
            type: "placeholder",
            base: {
              x: -1,
              y: -1,
              w: 2,
              h: 2,
              rotation: 0,
              opacity: 1,
              z: 0,
              visible: true,
            },
          },
        ],
        overrides: {},
        animations: [],
        params: [],
        bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
      },
    });
    return id;
  };

  it("fills the hole from the selection", () => {
    const attackId = withSlot();
    const tank = state().addPrimitive("shape", "circle");
    state().addSlide();
    state().select([tank]);

    const id = state().addAttack(attackId, { x: 0, y: 0 })!;

    expect(state().attacks.find((a) => a.id === id)!.slots).toEqual({
      victim: tank,
    });
  });

  it("refuses to place one with a hole it can't fill", () => {
    const attackId = withSlot();
    state().addSlide();
    state().clearSelection();

    // A definition with holes in it isn't a thing you can put on a board.
    expect(state().addAttack(attackId, { x: 0, y: 0 })).toBeUndefined();
    expect(state().attacks).toHaveLength(0);
  });

  it("takes the objects in document order, not click order", () => {
    state().setAttackDefs({});
    const attackId = withSlot();
    const first = state().addPrimitive("shape", "circle");
    state().addSlide();
    state().select([first]);
    state().toggleSelect(first);
    state().select([first]);

    const id = state().addAttack(attackId, { x: 0, y: 0 })!;
    expect(state().attacks.find((a) => a.id === id)!.slots["victim"]).toBe(
      first,
    );
  });
});

describe("updateAttack", () => {
  it("retunes position, rotation, scale and timing", () => {
    state().addSlide();
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    state().updateAttack(id, { x: 50, w: 300, rotation: 90, startMs: 250 });

    expect(state().attacks[0]).toMatchObject({
      x: 50,
      w: 300,
      rotation: 90,
      startMs: 250,
    });
  });

  it("moves an attack to another slide", () => {
    state().addSlide();
    const later = state().addSlide();
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    state().updateAttack(id, { slideId: later });
    expect(state().attacks[0]!.slideId).toBe(later);
  });

  it("ignores an unknown instance rather than throwing", () => {
    expect(() => state().updateAttack("ghost", { x: 1 })).not.toThrow();
  });
});

describe("removeAttack", () => {
  it("removes just that instance", () => {
    state().addSlide();
    const a = state().addAttack("atk1", { x: 1, y: 1 })!;
    state().addAttack("atk2", { x: 2, y: 2 });

    state().removeAttack(a);

    expect(state().attacks).toHaveLength(1);
    expect(state().attacks[0]!.attackId).toBe("atk2");
  });

  it("takes the attacks fired by a deleted slide with it", () => {
    const first = state().slides[0]!.id;
    state().addSlide();
    state().selectSlide(0);
    state().addAttack("atk1", { x: 0, y: 0 });
    state().selectSlide(1);
    const survivor = state().addAttack("atk2", { x: 0, y: 0 });

    state().deleteSlide(0);

    // Without its slide there is no moment for it to happen. (Undo brings the
    // slide and its attacks back together.)
    expect(state().attacks.map((a) => a.id)).toEqual([survivor]);
    expect(state().slides.map((s) => s.id)).not.toContain(first);
  });
});

describe("reorderAttack", () => {
  const three = () => {
    state().addSlide();
    return [
      state().addAttack("a", { x: 0, y: 0 })!,
      state().addAttack("b", { x: 0, y: 0 })!,
      state().addAttack("c", { x: 0, y: 0 })!,
    ];
  };
  /** Draw order, which is what "order" means — not the array's. */
  const order = () =>
    boardStack(state()).map((item) => {
      const attack = state().attacks.find((a) => a.id === item.id);
      return attack?.attackId ?? "object";
    });

  it("moves one slide at a time", () => {
    const [, b] = three();
    state().reorderAttack(b!, 1);
    expect(order()).toEqual(["a", "c", "b"]);
    state().reorderAttack(b!, -1);
    expect(order()).toEqual(["a", "b", "c"]);
  });

  it("clamps at the ends rather than wrapping", () => {
    const [a] = three();
    state().reorderAttack(a!, -5);
    expect(order()).toEqual(["a", "b", "c"]);
    state().reorderAttack(a!, 5);
    expect(order()).toEqual(["b", "c", "a"]);
  });

  it("moves past objects too — they share one stack", () => {
    const under = state().addPrimitive("shape", "circle");
    state().addSlide();
    const attack = state().addAttack("a", { x: 0, y: 0 })!;
    // It arrives on top, which is where a new thing belongs...
    expect(boardStack(state()).at(-1)!.id).toBe(attack);

    state().reorderAttack(attack, -1);

    // ...and can be put under the token standing on it, which is the whole
    // point: whatever is on top is what a click finds.
    expect(boardStack(state()).map((i) => i.id)).toEqual([attack, under]);
  });

  it("ignores an attack that isn't there", () => {
    three();
    expect(() => state().reorderAttack("ghost", 1)).not.toThrow();
    expect(order()).toEqual(["a", "b", "c"]);
  });
});

describe("an attack is document content in its own right", () => {
  it("counts as something on the board, so a lone attack isn't an empty plan", () => {
    state().addAttack("atk1", { x: 0, y: 0 });
    // What the toolbar reads: objects plus attacks.
    expect(state().objectIds.length + state().attacks.length).toBe(1);
  });

  it("marks the document as changed, so autosave fires for it", () => {
    // The slide already exists, so placing the attack is the *only* edit —
    // exactly the case that never saved.
    state().addSlide();
    const before = pickPlanDoc(state());
    state().addAttack("atk1", { x: 0, y: 0 });
    // Nothing else persists an attack: a plan whose only content is one has no
    // other edit to piggyback on.
    expect(sameDocument(before, pickPlanDoc(state()))).toBe(false);
  });

  it("comes along when its slide is duplicated", () => {
    const original = state().addAttack("atk1", { x: 10, y: 20 })!;
    state().duplicateSlide(0);

    expect(state().attacks).toHaveLength(2);
    const copy = state().attacks.find((a) => a.id !== original)!;
    // Same placement, its own identity, fired by the copied slide.
    expect(copy).toMatchObject({ attackId: "atk1", x: 10 - 200, y: 20 - 200 });
    expect(copy.slideId).toBe(state().slides[1]!.id);
  });

  it("drops a deleted object from the arguments that named it", () => {
    const tank = state().addPrimitive("shape", "circle");
    const healer = state().addPrimitive("shape", "circle");
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    state().updateAttack(id, { args: { victims: [tank, healer] } });

    state().deleteObjects([tank]);

    // A dangling reference would resurrect on undo and mean nothing at play.
    expect(state().attacks[0]!.args["victims"]).toEqual([healer]);
  });
});

describe("round-trip", () => {
  it("carries placed attacks and the encounter through the document", () => {
    state().loadPlan({
      id: "p",
      title: "t",
      raid: "Amirdrassil",
      encounterId: "enc1",
      background: { assetId: "arena", width: 1600, height: 900 },
      objects: [],
      attacks: [],
      slides: [{ id: "s0", states: {}, animations: [] }],
      schemaVersion: SCHEMA_VERSION,
    });
    state().addAttack("atk1", { x: 10, y: 20 });

    const plan = state().getPlan();
    expect(plan.encounterId).toBe("enc1");
    expect(attackIdsInPlan(plan)).toEqual(["atk1"]);
    expect(plan.attacks[0]).toMatchObject({ w: 400, h: 400, slideId: "s0" });
  });
});
