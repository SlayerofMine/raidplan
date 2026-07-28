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

/** A member's row inside an open group — its own title, its own click meaning. */
const memberRow = (name: string) =>
  screen.getByTitle(
    `${name} — on its own, out of its group. Double-click to rename`,
  );

/** Group A and B, leaving C loose. Returns their ids and the group's. */
function groupAB(): { a: string; b: string; c: string; groupId: string } {
  const [a, b, c] = threeObjects();
  act(() => {
    state().select([a, b]);
    state().groupSelected();
    state().clearSelection();
  });
  // Read the id back off a member rather than from `groupSelected` — `act`
  // returns a thenable of its own, not the callback's value.
  return { a, b, c, groupId: state().objects[a]!.groupId! };
}

describe("ObjectsPanel groups", () => {
  it("shows a group as one row, shut, with its members folded away", () => {
    const { c } = groupAB();
    render(<ObjectsPanel />);

    expect(screen.getAllByTestId("group-row")).toHaveLength(1);
    expect(screen.queryByTestId("group-members")).not.toBeInTheDocument();
    // The group stands in for both its members; only C is still a row.
    expect(rowNames()).toEqual([c]);

    fireEvent.click(screen.getByTestId("group-toggle"));
    expect(screen.getByTestId("group-members")).toBeInTheDocument();
    expect(screen.getAllByTestId("object-row")).toHaveLength(3);
  });

  it("selects the whole group from its header", () => {
    const { a, b } = groupAB();
    render(<ObjectsPanel />);

    fireEvent.click(screen.getByTitle(/^Group — selects all 2/));
    expect([...state().selectedIds].sort()).toEqual([a, b].sort());
    expect(screen.getByTestId("group-row")).toHaveAttribute(
      "data-selected",
      "true",
    );
  });

  it("picks one member on its own, and says so", () => {
    const { a, b } = groupAB();
    render(<ObjectsPanel />);
    fireEvent.click(screen.getByTestId("group-toggle"));

    fireEvent.click(memberRow("A"));
    expect(state().selectedIds).toEqual([a]);
    // Still a group — and the header shows it is only partly picked.
    expect(state().objects[a]!.groupId).toBe(state().objects[b]!.groupId);
    const header = screen.getByTestId("group-row");
    expect(header).toHaveAttribute("data-selected", "false");
    expect(header).toHaveAttribute("data-partial", "true");

    // Ctrl-click adds the other member alone rather than toggling all of it.
    fireEvent.click(memberRow("B"), { ctrlKey: true });
    expect([...state().selectedIds].sort()).toEqual([a, b].sort());
    fireEvent.click(memberRow("B"), { ctrlKey: true });
    expect(state().selectedIds).toEqual([a]);
  });

  it("names the group, and falls back to Group when cleared", () => {
    const { groupId } = groupAB();
    render(<ObjectsPanel />);

    fireEvent.doubleClick(screen.getByTitle(/^Group — selects all 2/));
    fireEvent.change(screen.getByTestId("object-rename"), {
      target: { value: "Melee" },
    });
    fireEvent.keyDown(screen.getByTestId("object-rename"), { key: "Enter" });
    expect(state().groups[groupId]).toBe("Melee");
    expect(screen.getByTitle(/^Melee — selects all 2/)).toBeInTheDocument();
  });

  it("hides and locks the whole group from its header", () => {
    const { a, b } = groupAB();
    render(<ObjectsPanel />);

    fireEvent.click(screen.getByLabelText("Hide Group"));
    expect(state().slides[0]!.states[a]!.visible).toBe(false);
    expect(state().slides[0]!.states[b]!.visible).toBe(false);
    // The header now offers the way back.
    fireEvent.click(screen.getByLabelText("Show Group"));
    expect(state().slides[0]!.states[a]!.visible).toBe(true);

    fireEvent.click(screen.getByLabelText("Lock Group"));
    expect(state().objects[a]!.locked).toBe(true);
    expect(state().objects[b]!.locked).toBe(true);
  });

  it("reads locked only when every member is", () => {
    const { a } = groupAB();
    act(() => state().setLocked(a, true));
    render(<ObjectsPanel />);

    // One locked member doesn't make the group locked — the header offers to
    // lock it rather than claiming it already is.
    expect(screen.getByLabelText("Lock Group")).toBeInTheDocument();
  });

  it("ungroups from the header, leaving the objects behind", () => {
    const { a, b, c } = groupAB();
    render(<ObjectsPanel />);

    fireEvent.click(screen.getByTestId("group-ungroup"));
    expect(screen.queryByTestId("group-row")).not.toBeInTheDocument();
    expect(rowNames()).toEqual([c, b, a]);
    expect(state().objects[a]!.groupId).toBeUndefined();
  });

  it("deletes the whole group from the header", () => {
    const { c } = groupAB();
    render(<ObjectsPanel />);

    fireEvent.click(screen.getByLabelText("Delete Group"));
    expect(screen.queryByTestId("group-row")).not.toBeInTheDocument();
    expect(rowNames()).toEqual([c]);
  });
});
