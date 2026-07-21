import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AttackBindings, AttackParam } from "@raidplan/shared";
import { AttackParamsPanel } from "../../src/editor/AttackParamsPanel";
import { AttackArgs } from "../../src/editor/AttackArgs";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

const state = () => useEditorStore.getState();
const EMPTY: AttackBindings = { collideWith: {}, durationMs: {}, tint: {} };

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
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onParamsChange).toHaveBeenCalledWith([
      { key: "victims", label: "Caught by", type: "objectRefs" },
    ]);
  });

  it("points an objectRefs parameter at an animation's collideWith", async () => {
    const user = userEvent.setup();
    // The designer's plan *is* the definition: one step holds its animations.
    const objectId = state().addPrimitive("shape", "circle");
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

    await user.selectOptions(screen.getByLabelText("Caught by drives"), animId);
    expect(onBindingsChange).toHaveBeenCalledWith({
      collideWith: { [animId]: "victims" },
      durationMs: {},
      tint: {},
    });
  });

  it("drops bindings that pointed at a removed parameter", async () => {
    const user = userEvent.setup();
    const onBindingsChange = vi.fn();
    render(
      <AttackParamsPanel
        params={[{ key: "victims", label: "Caught by", type: "objectRefs" }]}
        bindings={{ collideWith: { a1: "victims" }, durationMs: {}, tint: {} }}
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
