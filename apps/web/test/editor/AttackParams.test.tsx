import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AttackBindings, AttackParam } from "@raidplan/shared";
import { AttackParamsPanel } from "../../src/editor/AttackParamsPanel";
import { AttackArgs } from "../../src/editor/AttackArgs";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

const state = () => useEditorStore.getState();
const EMPTY: AttackBindings = {
  collideWith: {},
  durationMs: {},
  delayMs: {},
  tint: {},
};

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  clearHistory();
});

describe("AttackParamsPanel — declaring what a plan must supply", () => {
  it("adds a parameter", async () => {
    const user = userEvent.setup();
    const onParamsChange = vi.fn();
    render(
      <AttackParamsPanel
        params={[]}
        bindings={EMPTY}
        onParamsChange={onParamsChange}
        onBindingsChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("no-params")).toBeInTheDocument();
    await user.type(screen.getByLabelText("New parameter key"), "victims");
    await user.type(screen.getByLabelText("New parameter label"), "Caught by");
    await user.click(screen.getByRole("button", { name: "Add parameter" }));

    expect(onParamsChange).toHaveBeenCalledWith([
      { key: "victims", label: "Caught by", type: "objectRefs" },
    ]);
  });

  it("points an objectRefs parameter at an animation's collideWith", async () => {
    const user = userEvent.setup();
    // The designer's plan *is* the definition: one step holds its animations.
    const objectId = state().addPrimitive("shape", "circle");
    state().updateObject(objectId, { name: "Orb" });
    state().addStep();
    const animId = state().addAnimation(0, objectId)!;

    const params: AttackParam[] = [
      { key: "victims", label: "Caught by", type: "objectRefs" },
    ];
    const onBindingsChange = vi.fn();
    render(
      <AttackParamsPanel
        params={params}
        bindings={EMPTY}
        onParamsChange={vi.fn()}
        onBindingsChange={onBindingsChange}
      />,
    );

    // Each place is a tick-box, named for which animation on which object —
    // "move" alone is unreadable the moment an attack has three of them.
    await user.click(
      screen.getByLabelText("Caught by collision targets of: 1. move · Orb"),
    );
    expect(onBindingsChange).toHaveBeenCalledWith({
      collideWith: { [animId]: "victims" },
      durationMs: {},
      delayMs: {},
      tint: {},
    });
  });

  it("drives as many places as you tick — the point of naming it once", async () => {
    const user = userEvent.setup();
    const orb = state().addPrimitive("shape", "circle");
    state().updateObject(orb, { name: "Orb" });
    const cone = state().addPrimitive("shape", "circle");
    state().updateObject(cone, { name: "Cone" });
    state().addStep();
    const first = state().addAnimation(0, orb)!;
    const second = state().addAnimation(0, cone)!;

    const onBindingsChange = vi.fn();
    render(
      <AttackParamsPanel
        params={[{ key: "victims", label: "Caught by", type: "objectRefs" }]}
        // One place already ticked; the second must join it rather than
        // replace it — "the tanks" is one answer feeding several animations.
        bindings={{ ...EMPTY, collideWith: { [first]: "victims" } }}
        onParamsChange={vi.fn()}
        onBindingsChange={onBindingsChange}
      />,
    );

    await user.click(
      screen.getByLabelText("Caught by collision targets of: 2. move · Cone"),
    );
    expect(onBindingsChange).toHaveBeenCalledWith({
      ...EMPTY,
      collideWith: { [first]: "victims", [second]: "victims" },
    });
  });

  it("unticks one place without disturbing the others", async () => {
    const user = userEvent.setup();
    const orb = state().addPrimitive("shape", "circle");
    state().updateObject(orb, { name: "Orb" });
    state().addStep();
    const animId = state().addAnimation(0, orb)!;

    const onBindingsChange = vi.fn();
    render(
      <AttackParamsPanel
        params={[{ key: "victims", label: "Caught by", type: "objectRefs" }]}
        bindings={{ ...EMPTY, collideWith: { [animId]: "victims" } }}
        onParamsChange={vi.fn()}
        onBindingsChange={onBindingsChange}
      />,
    );

    await user.click(
      screen.getByLabelText("Caught by collision targets of: 1. move · Orb"),
    );
    expect(onBindingsChange).toHaveBeenCalledWith(EMPTY);
  });

  it("shows a place another parameter already drives as taken", () => {
    const orb = state().addPrimitive("shape", "circle");
    state().updateObject(orb, { name: "Orb" });
    state().addStep();
    const animId = state().addAnimation(0, orb)!;

    render(
      <AttackParamsPanel
        params={[
          { key: "victims", label: "Caught by", type: "objectRefs" },
          { key: "others", label: "Also caught by", type: "objectRefs" },
        ]}
        bindings={{ ...EMPTY, collideWith: { [animId]: "victims" } }}
        onParamsChange={vi.fn()}
        onBindingsChange={vi.fn()}
      />,
    );

    // One place reads from exactly one parameter, so the second offers it
    // disabled and says who has it, rather than silently refusing.
    const taken = screen.getByLabelText(
      "Also caught by collision targets of: 1. move · Orb",
    );
    expect(taken).toBeDisabled();
    expect(screen.getByText("— Caught by")).toBeInTheDocument();
  });

  it("offers a number both timing slots — a parameter isn't one-trick", async () => {
    const user = userEvent.setup();
    const orb = state().addPrimitive("shape", "circle");
    state().updateObject(orb, { name: "Orb" });
    state().addStep();
    const animId = state().addAnimation(0, orb)!;

    const onBindingsChange = vi.fn();
    render(
      <AttackParamsPanel
        params={[{ key: "cast", label: "Cast time", type: "number" }]}
        bindings={EMPTY}
        onParamsChange={vi.fn()}
        onBindingsChange={onBindingsChange}
      />,
    );

    await user.click(
      screen.getByLabelText("Cast time delay of: 1. move · Orb"),
    );
    expect(onBindingsChange).toHaveBeenCalledWith({
      ...EMPTY,
      delayMs: { [animId]: "cast" },
    });
  });

  it("says so when a parameter drives nothing — the half everyone misses", () => {
    const objectId = state().addPrimitive("shape", "circle");
    state().addStep();
    state().addAnimation(0, objectId);

    render(
      <AttackParamsPanel
        params={[{ key: "victims", label: "Caught by", type: "objectRefs" }]}
        bindings={EMPTY}
        onParamsChange={vi.fn()}
        onBindingsChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Not pointed at anything yet/)).toBeInTheDocument();
  });

  it("points at the missing half when there's nothing to drive", () => {
    render(
      <AttackParamsPanel
        params={[{ key: "victims", label: "Caught by", type: "objectRefs" }]}
        bindings={EMPTY}
        onParamsChange={vi.fn()}
        onBindingsChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("no-targets-victims-collideWith"),
    ).toHaveTextContent("Add an animation");
  });

  it("admits when a type drives nothing at all rather than offering a dead select", () => {
    render(
      <AttackParamsPanel
        params={[{ key: "note", label: "Note", type: "text" }]}
        bindings={EMPTY}
        onParamsChange={vi.fn()}
        onBindingsChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/inert/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("drops bindings that pointed at a removed parameter", async () => {
    const user = userEvent.setup();
    const onBindingsChange = vi.fn();
    render(
      <AttackParamsPanel
        params={[{ key: "victims", label: "Caught by", type: "objectRefs" }]}
        bindings={{
          collideWith: { a1: "victims" },
          durationMs: {},
          delayMs: {},
          tint: {},
        }}
        onParamsChange={vi.fn()}
        onBindingsChange={onBindingsChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove Caught by" }));
    // Nothing may dangle at a parameter that no longer exists.
    expect(onBindingsChange).toHaveBeenCalledWith(EMPTY);
  });
});

describe("AttackArgs — answering with this plan's objects", () => {
  const instance = {
    id: "i1",
    attackId: "atk1",
    stepId: "s0",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    startMs: 0,
    args: {},
  };

  it("picks plan objects for an objectRefs parameter", async () => {
    const user = userEvent.setup();
    const objectId = state().addPrimitive("shape", "circle");
    state().updateObject(objectId, { name: "Tank" });
    const onChange = vi.fn();

    render(
      <AttackArgs
        params={[{ key: "victims", label: "Caught by", type: "objectRefs" }]}
        instance={instance}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText("Caught by: Tank"));
    expect(onChange).toHaveBeenCalledWith("victims", [objectId]);
  });

  it("renders nothing when the attack declares no parameters", () => {
    const { container } = render(
      <AttackArgs params={[]} instance={instance} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
