import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ICONS } from "@raidplan/shared";
import { boardStack, useEditorStore } from "../../src/store/editorStore";
import { PropertiesPanel } from "../../src/editor/PropertiesPanel";

const state = () => useEditorStore.getState();
const iconId = ICONS[0]!.id;

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
});

describe("PropertiesPanel — style controls", () => {
  it("shows fill + outline for a shape and writes to the store", () => {
    const id = state().addPrimitive("shape", "circle");
    state().select([id]);
    render(<PropertiesPanel />);

    const fill = screen.getByTestId("style-fill");
    fireEvent.change(fill, { target: { value: "striped" } });
    expect(state().objects[id]!.style?.fill).toBe("striped");

    fireEvent.click(screen.getByTestId("style-outline"));
    expect(state().objects[id]!.style?.outline).toBe(false);
  });

  it("offers the Edge toggle only for a voidzone", () => {
    const circle = state().addPrimitive("shape", "circle");
    state().select([circle]);
    const { rerender } = render(<PropertiesPanel />);
    expect(screen.queryByTestId("style-edge")).not.toBeInTheDocument();

    const voidzone = state().addPrimitive("shape", "voidzone");
    state().select([voidzone]);
    rerender(<PropertiesPanel />);
    const edge = screen.getByTestId("style-edge");
    fireEvent.change(edge, { target: { value: "round" } });
    expect(state().objects[voidzone]!.style?.edge).toBe("round");
  });

  it("shows the tether Line toggle for a tether", () => {
    const a = state().addIcon(iconId);
    const b = state().addIcon(iconId);
    const t = state().addTether(a, b)!;
    state().select([t]);
    render(<PropertiesPanel />);

    fireEvent.change(screen.getByTestId("style-line"), {
      target: { value: "straight" },
    });
    expect(state().objects[t]!.style?.line).toBe("straight");
    // A tether has no fill control.
    expect(screen.queryByTestId("style-fill")).not.toBeInTheDocument();
  });

  it("shows no style controls for a plain token", () => {
    const id = state().addIcon(iconId);
    state().select([id]);
    render(<PropertiesPanel />);
    expect(screen.queryByTestId("style-fill")).not.toBeInTheDocument();
    expect(screen.queryByTestId("style-line")).not.toBeInTheDocument();
  });
});

/**
 * A placed attack is a selection like any other, so it gets the properties
 * panel: the canvas places it roughly, this says exactly. It has fewer fields
 * because there is less of it — how an attack *looks* belongs to its
 * definition, not to the plan.
 */
describe("PropertiesPanel — a placed attack", () => {
  const placed = () => {
    state().addStep();
    return state().addAttack("atk1", { x: 400, y: 300 })!;
  };

  it("edits the rectangle it is drawn into", () => {
    const id = placed();
    render(<PropertiesPanel />);

    fireEvent.change(screen.getByTestId("attack-prop-x"), {
      target: { value: "120" },
    });
    fireEvent.change(screen.getByTestId("attack-prop-w"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByTestId("attack-prop-rotation"), {
      target: { value: "45" },
    });

    expect(state().attacks.find((a) => a.id === id)).toMatchObject({
      x: 120,
      w: 500,
      rotation: 45,
    });
  });

  it("refuses a rectangle with no width", () => {
    const id = placed();
    render(<PropertiesPanel />);

    fireEvent.change(screen.getByTestId("attack-prop-w"), {
      target: { value: "0" },
    });
    // Unit space is mapped onto this rectangle; a zero one has nowhere to put.
    expect(state().attacks.find((a) => a.id === id)!.w).toBe(1);
  });

  it("names this copy, which is then what it's called", () => {
    const id = placed();
    render(<PropertiesPanel />);

    fireEvent.change(screen.getByTestId("attack-prop-name"), {
      target: { value: "north cone" },
    });
    expect(state().attacks.find((a) => a.id === id)!.name).toBe("north cone");
  });

  it("switches one off without losing where it was", () => {
    const id = placed();
    render(<PropertiesPanel />);

    fireEvent.click(screen.getByTestId("attack-prop-visible"));

    const instance = state().attacks.find((a) => a.id === id)!;
    expect(instance.visible).toBe(false);
    expect(instance.x).toBe(200); // still placed, just not happening
  });

  it("locks one against being dragged", () => {
    const id = placed();
    render(<PropertiesPanel />);

    fireEvent.click(screen.getByTestId("attack-prop-locked"));
    expect(state().attacks.find((a) => a.id === id)!.locked).toBe(true);
  });

  it("reorders it through the board's stack, objects included", () => {
    const object = state().addPrimitive("shape", "circle");
    state().addStep();
    const first = state().addAttack("atk1", { x: 0, y: 0 })!;
    state().addAttack("atk2", { x: 0, y: 0 });
    state().selectAttack([first]);
    render(<PropertiesPanel />);

    fireEvent.click(screen.getByTitle("Bring to front"));
    expect(boardStack(state()).at(-1)!.id).toBe(first);

    fireEvent.click(screen.getByTitle("Send to back"));
    const ids = boardStack(state()).map((i) => i.id);
    expect(ids[0]).toBe(first);
    expect(ids).toContain(object);
  });

  it("gives way to an object selection", () => {
    placed();
    const object = state().addPrimitive("shape", "circle"); // clears the attack
    render(<PropertiesPanel />);

    expect(screen.queryByTestId("attack-properties")).not.toBeInTheDocument();
    expect(screen.getByTestId("properties")).toBeInTheDocument();
    expect(object).toBeTruthy();
  });
});
