import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ICONS } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { AnimationPanel } from "./AnimationPanel";

const state = () => useEditorStore.getState();
const iconId = ICONS[0]!.id;

/** An orb with an animation on step 0, plus a token that could collide with it. */
function seed() {
  const orb = state().addPrimitive("shape", "pickup");
  state().updateObject(orb, { name: "Orb" });
  const tank = state().addIcon(iconId);
  state().updateObject(tank, { name: "Tank" });
  state().addStep();
  const animId = state().addAnimation(0, orb)!;
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
