import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ObjectsPanel } from "../../src/editor/ObjectsPanel";
import { useEditorStore } from "../../src/store/editorStore";

const state = () => useEditorStore.getState();

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
});

/** Three shapes, named so the rows are tellable apart. */
function threeObjects(): [string, string, string] {
  const ids = ["A", "B", "C"].map((name) => {
    const id = state().addPrimitive("shape", "circle");
    state().updateObject(id, { name });
    return id;
  });
  state().clearSelection();
  return ids as [string, string, string];
}

/** The rows, in the order the panel draws them (front-most first). */
const rowNames = () =>
  screen
    .getAllByTestId("object-row")
    .map((row) => row.getAttribute("data-object-id"));

const row = (name: string) =>
  screen.getByTitle(`${name} — double-click to rename`);

describe("ObjectsPanel", () => {
  it("lists only this slide's cast, front-most first", () => {
    const [a, b, c] = threeObjects();
    render(<ObjectsPanel />);
    expect(rowNames()).toEqual([c, b, a]);

    // A slide of its own has none of them.
    act(() => void state().addSlide());
    expect(screen.getByTestId("no-objects")).toBeInTheDocument();
  });

  it("selects on click, and mirrors a selection made elsewhere", () => {
    const [a, , c] = threeObjects();
    render(<ObjectsPanel />);

    fireEvent.click(row("A"));
    expect(state().selectedIds).toEqual([a]);

    // The canvas picking something shows up here — it is one selection.
    act(() => state().select([c]));
    expect(
      screen
        .getByTestId("object-list")
        .querySelector(`[data-object-id="${c}"]`),
    ).toHaveAttribute("data-selected", "true");
  });

  it("adds and removes one with ctrl-click", () => {
    const [a, b] = threeObjects();
    render(<ObjectsPanel />);

    fireEvent.click(row("A"));
    fireEvent.click(row("B"), { ctrlKey: true });
    expect([...state().selectedIds].sort()).toEqual([a, b].sort());

    fireEvent.click(row("B"), { ctrlKey: true });
    expect(state().selectedIds).toEqual([a]);
  });

  it("takes everything in between with shift-click", () => {
    const [a, b, c] = threeObjects();
    render(<ObjectsPanel />);

    fireEvent.click(row("C"));
    fireEvent.click(row("A"), { shiftKey: true });
    expect([...state().selectedIds].sort()).toEqual([a, b, c].sort());

    // Shift alone replaces: the anchor stays on C, so this is C..B.
    fireEvent.click(row("B"), { shiftKey: true });
    expect([...state().selectedIds].sort()).toEqual([b, c].sort());
  });

  it("keeps the existing pick when shift is held with ctrl", () => {
    const [a, b, c] = threeObjects();
    render(<ObjectsPanel />);

    fireEvent.click(row("A"));
    fireEvent.click(row("C"), { ctrlKey: true });
    fireEvent.click(row("B"), { shiftKey: true, ctrlKey: true });
    expect([...state().selectedIds].sort()).toEqual([a, b, c].sort());
  });

  it("renames on double-click, and Escape abandons the edit", () => {
    const [a] = threeObjects();
    render(<ObjectsPanel />);

    fireEvent.doubleClick(row("A"));
    fireEvent.change(screen.getByTestId("object-rename"), {
      target: { value: "Tank 1" },
    });
    fireEvent.keyDown(screen.getByTestId("object-rename"), { key: "Enter" });
    expect(state().objects[a]!.base.name).toBe("Tank 1");

    fireEvent.doubleClick(row("Tank 1"));
    fireEvent.change(screen.getByTestId("object-rename"), {
      target: { value: "nope" },
    });
    fireEvent.keyDown(screen.getByTestId("object-rename"), { key: "Escape" });
    expect(state().objects[a]!.base.name).toBe("Tank 1");
  });

  it("hides, locks and deletes from the row", () => {
    const [a] = threeObjects();
    render(<ObjectsPanel />);

    fireEvent.click(screen.getByLabelText("Hide A"));
    expect(state().slides[0]!.states[a]!.visible).toBe(false);

    fireEvent.click(screen.getByLabelText("Lock A"));
    expect(state().objects[a]!.locked).toBe(true);

    fireEvent.click(screen.getByLabelText("Delete A"));
    expect(state().objects[a]).toBeUndefined();
    expect(rowNames()).toHaveLength(2);
  });
});
