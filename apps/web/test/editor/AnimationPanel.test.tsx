import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ICONS } from "@raidplan/shared";
import { useEditorStore } from "../../src/store/editorStore";
import { AnimationPanel } from "../../src/editor/AnimationPanel";

const state = () => useEditorStore.getState();
const iconId = ICONS[0]!.id;

/**
 * An orb with an animation on step 0, plus a token that could collide with it.
 * The orb is left selected: the panel inspects the selection, so an animation
 * only shows when its object is picked.
 */
function seed() {
  const orb = state().addPrimitive("shape", "pickup");
  state().updateObject(orb, { name: "Orb" });
  const tank = state().addIcon(iconId);
  state().updateObject(tank, { name: "Tank" });
  state().addStep();
  const animId = state().addAnimation(0, orb)!;
  state().select([orb]);
  return { orb, tank, animId };
}

const anim = (animId: string) =>
  state().steps[0]!.animations.find((a) => a.id === animId)!;

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
});

describe("AnimationPanel — collision colliders", () => {
  it("hides the collider picker for time-based triggers", () => {
    seed(); // addAnimation defaults to onEnter
    render(<AnimationPanel />);
    expect(screen.queryByTestId("anim-colliders")).not.toBeInTheDocument();
  });

  it("shows the picker once the trigger is onCollision", () => {
    const { animId } = seed();
    state().updateAnimation(0, animId, { trigger: "onCollision" });
    render(<AnimationPanel />);
    expect(screen.getByTestId("anim-colliders")).toBeInTheDocument();
    // Nothing armed yet, so it warns that it can never fire.
    expect(screen.getByTestId("anim-colliders-empty")).toBeInTheDocument();
  });

  it("writes the chosen colliders to the animation", () => {
    const { tank, animId } = seed();
    state().updateAnimation(0, animId, { trigger: "onCollision" });
    render(<AnimationPanel />);

    fireEvent.click(screen.getByTestId(`anim-collider-${tank}`));
    expect(anim(animId).collideWith).toEqual([tank]);
    // ...and unticking removes it again.
    fireEvent.click(screen.getByTestId(`anim-collider-${tank}`));
    expect(anim(animId).collideWith).toEqual([]);
  });

  it("never offers the animated object as its own collider", () => {
    const { orb, tank, animId } = seed();
    state().updateAnimation(0, animId, { trigger: "onCollision" });
    render(<AnimationPanel />);
    expect(
      screen.queryByTestId(`anim-collider-${orb}`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(`anim-collider-${tank}`)).toBeInTheDocument();
  });

  it("labels colliders by name, not by internal id", () => {
    const { tank, animId } = seed();
    state().updateAnimation(0, animId, { trigger: "onCollision" });
    render(<AnimationPanel />);
    expect(screen.getByTestId("anim-colliders")).toHaveTextContent("Tank");
    expect(screen.getByTestId("anim-colliders")).not.toHaveTextContent(tank);
  });
});

/**
 * The Timeline is the step's overview; this column inspects what you picked.
 * Showing every animation here as well made a busy step unreadable.
 */
describe("AnimationPanel — scoped to the selection", () => {
  it("shows the selected object's animations", () => {
    seed();
    render(<AnimationPanel />);
    expect(screen.getAllByTestId("anim-row")).toHaveLength(1);
  });

  it("leaves out animations belonging to something else, and says how many", () => {
    const { tank } = seed();
    state().select([tank]);
    render(<AnimationPanel />);

    expect(screen.queryByTestId("anim-row")).not.toBeInTheDocument();
    expect(screen.getByTestId("anim-empty")).toBeInTheDocument();
    // Not silently: a hidden animation you can't account for is worse than a
    // long list.
    expect(screen.getByTestId("anim-elsewhere")).toHaveTextContent("1 more");
  });

  it("asks for a selection rather than showing the whole step", () => {
    seed();
    state().clearSelection();
    render(<AnimationPanel />);

    expect(screen.queryByTestId("anim-row")).not.toBeInTheDocument();
    expect(screen.getByTestId("anim-no-selection")).toBeInTheDocument();
  });

  it("shows both objects' animations for a multi-object selection", () => {
    const { orb, tank } = seed();
    state().addAnimation(0, tank);
    state().select([orb, tank]);
    render(<AnimationPanel />);

    expect(screen.getAllByTestId("anim-row")).toHaveLength(2);
    expect(screen.queryByTestId("anim-elsewhere")).not.toBeInTheDocument();
  });
});
