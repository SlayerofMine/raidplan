import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ICONS } from "@raidplan/shared";
import { useEditorStore } from "../../src/store/editorStore";
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
