import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { slideAttacks, type AttackDef, type Plan } from "@raidplan/shared";
import { useEditorStore } from "../../src/store/editorStore";
import { AnimationPanel } from "../../src/editor/AnimationPanel";

const state = () => useEditorStore.getState();

const box = {
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  opacity: 1,
  visible: true,
};

/** A one-slot attack with one exposed colour, and a token to bind it to. */
const DEF: AttackDef = {
  id: "def_1",
  name: "Fireball",
  source: "plan",
  objects: [
    {
      id: "puddle",
      type: "shape",
      shape: "voidzone",
      base: { ...box, z: 0 },
    },
    { id: "bolt", type: "token", base: { ...box, z: 1 } },
    {
      id: "target",
      type: "token",
      slotName: "the tank",
      base: { ...box, z: 2 },
    },
  ],
  slide: {
    id: "def-slide",
    states: {
      puddle: box,
      bolt: { ...box, x: 200 },
      target: { ...box, x: 400 },
    },
    animations: [
      {
        id: "a1",
        objectId: "bolt",
        kind: "motion",
        effect: "move",
        trigger: "onEnter",
        delayMs: 0,
        durationMs: 500,
        easing: "power2.out",
        params: { toX: 400, toY: 0 },
      },
    ],
  },
  params: [
    {
      name: "colour",
      label: "Colour",
      kind: "color",
      value: "#ff0000",
      targets: [{ on: "object", targetId: "puddle", field: "tint" }],
    },
  ],
};

const PLAN: Plan = {
  id: "local",
  title: "T",
  raid: "",
  background: { assetId: "arena", width: 1600, height: 900 },
  objects: [{ id: "tank", type: "token", base: { ...box, x: 800, z: 0 } }],
  groups: {},
  attacks: [DEF],
  slides: [
    {
      id: "slide-1",
      states: { tank: { ...box, x: 800, y: 500 } },
      animations: [],
    },
  ],
  schemaVersion: 7,
};

let instanceId: string;

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  state().loadPlan(PLAN);
  state().select(["tank"]);
  instanceId = state().placeAttack("def_1", { x: 0, y: 0 })!;
});

describe("the Animations panel, on a placed attack", () => {
  it("shows the attack as one thing rather than its derived animations", () => {
    render(<AnimationPanel />);
    expect(screen.getByTestId("attack-card")).toBeInTheDocument();
    expect(screen.queryByTestId("anim-list")).not.toBeInTheDocument();
  });

  it("names the placement", () => {
    render(<AnimationPanel />);
    expect(screen.getByTestId("attack-card")).toHaveTextContent("Fireball");
  });

  it("offers the parameters the author exposed, at their defaults", () => {
    render(<AnimationPanel />);
    expect(screen.getByTestId("attack-param-colour")).toHaveValue("#ff0000");
  });

  it("re-derives the attack when a parameter is changed", () => {
    render(<AnimationPanel />);
    fireEvent.change(screen.getByTestId("attack-param-colour"), {
      target: { value: "#00ff00" },
    });
    const puddle = state()
      .objectIds.map((id) => state().objects[id]!)
      .find((o) => o.attackId === instanceId && o.shape === "voidzone");
    expect(puddle?.base.tint).toBe("#00ff00");
  });

  it("says what fills each slot, and rebinds it", () => {
    const other = state().addIcon("marker-skull");
    state().select(
      state().objectIds.filter((id) => state().objects[id]?.attackId),
    );
    render(<AnimationPanel />);
    fireEvent.change(screen.getByTestId("attack-slot-target"), {
      target: { value: other },
    });
    expect(slideAttacks(state().slides[0]!)[instanceId]!.slots.target).toBe(
      other,
    );
  });

  it("scales the whole placement in one axis, which the board's handles deliberately can't", () => {
    render(<AnimationPanel />);
    fireEvent.change(screen.getByTestId("attack-scale-x"), {
      target: { value: "250" },
    });
    const transform = slideAttacks(state().slides[0]!)[instanceId]!.transform;
    expect(transform.sx).toBeCloseTo(2.5, 6);
    expect(transform.sy).toBe(1);
  });

  it("detaches to plain objects, and the panel goes back to showing animations", () => {
    const { rerender } = render(<AnimationPanel />);
    fireEvent.click(screen.getByTestId("attack-detach"));
    expect(slideAttacks(state().slides[0]!)[instanceId]).toBeUndefined();
    rerender(<AnimationPanel />);
    expect(screen.queryByTestId("attack-card")).not.toBeInTheDocument();
  });

  it("deletes the placement, leaving the token it was bound to", () => {
    render(<AnimationPanel />);
    fireEvent.click(screen.getByTestId("attack-delete"));
    expect(slideAttacks(state().slides[0]!)[instanceId]).toBeUndefined();
    expect(state().objects.tank).toBeDefined();
  });
});
