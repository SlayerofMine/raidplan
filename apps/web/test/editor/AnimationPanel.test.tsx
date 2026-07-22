import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ICONS } from "@raidplan/shared";
import {
  clearHistory,
  temporalStore,
  useEditorStore,
} from "../../src/store/editorStore";
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

  it("animates every selected object at once, and says how many", async () => {
    const { orb, tank } = seed();
    state().deleteAnimation(0, state().steps[0]!.animations[0]!.id);
    state().select([orb, tank]);
    render(<AnimationPanel />);

    const button = screen.getByTestId("add-animation");
    expect(button).toHaveTextContent("+ Animate 2 objects");
    fireEvent.click(button);

    // Two animations, but one row: they're the same thing, so they're edited
    // as one thing.
    expect(state().steps[0]!.animations).toHaveLength(2);
    const rows = screen.getAllByTestId("anim-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-objects", "2");
    expect(rows[0]).toHaveTextContent("2 objects");
  });

  it("shows both objects' animations for a multi-object selection", () => {
    const { orb, tank, animId } = seed();
    const other = state().addAnimation(0, tank)!;
    state().updateAnimation(0, other, { effect: "fade" });
    state().select([orb, tank]);
    render(<AnimationPanel />);

    // Different effects, so they don't share a row.
    expect(screen.getAllByTestId("anim-row")).toHaveLength(2);
    expect(animId).not.toBe(other);
    expect(screen.queryByTestId("anim-elsewhere")).not.toBeInTheDocument();
  });
});

/**
 * The point of animating a selection together: keep editing it together. Doing
 * the same six edits six times would give the button back with one hand what it
 * took with the other.
 */
describe("AnimationPanel — one row, many objects", () => {
  const two = () => {
    const orb = state().addPrimitive("shape", "pickup");
    state().updateObject(orb, { name: "Orb" });
    const tank = state().addIcon(iconId);
    state().updateObject(tank, { name: "Tank" });
    state().addStep();
    state().select([orb, tank]);
    state().animateSelection(0);
    return { orb, tank };
  };

  it("applies an edit to every animation in the row", () => {
    two();
    render(<AnimationPanel />);

    fireEvent.change(screen.getByTestId("anim-effect"), {
      target: { value: "scale" },
    });

    expect(state().steps[0]!.animations.map((a) => a.effect)).toEqual([
      "scale",
      "scale",
    ]);
    // Still one row: they still agree.
    expect(screen.getAllByTestId("anim-row")).toHaveLength(1);
  });

  it("edits the row in one undo, not one per object", () => {
    two();
    clearHistory();
    render(<AnimationPanel />);

    fireEvent.change(screen.getByTestId("anim-duration"), {
      target: { value: "900" },
    });
    expect(state().steps[0]!.animations.map((a) => a.durationMs)).toEqual([
      900, 900,
    ]);

    temporalStore.getState().undo();
    expect(state().steps[0]!.animations.map((a) => a.durationMs)).toEqual([
      500, 500,
    ]);
  });

  it("splits as soon as one of them differs", () => {
    const { orb } = two();

    // Single out one object and change only its animation — the way you'd give
    // one member of a group its own delay.
    state().select([orb]);
    const mine = state().steps[0]!.animations.find((a) => a.objectId === orb)!;
    state().updateAnimation(0, mine.id, { delayMs: 250 });

    state().select(state().objectIds);
    render(<AnimationPanel />);

    const rows = screen.getAllByTestId("anim-row");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.getAttribute("data-objects"))).toEqual(["1", "1"]);
  });

  it("deletes the whole row at once", () => {
    two();
    render(<AnimationPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Delete animation" }));

    expect(state().steps[0]!.animations).toHaveLength(0);
  });

  it("keeps two animations of one object apart, however alike", () => {
    const orb = state().addPrimitive("shape", "pickup");
    state().addStep();
    state().addAnimation(0, orb);
    state().addAnimation(0, orb);
    state().select([orb]);
    render(<AnimationPanel />);

    // They look identical, but they're two separate things: merging them would
    // make either one impossible to edit alone.
    expect(screen.getAllByTestId("anim-row")).toHaveLength(2);
  });
});

/**
 * `kind` and `effect` are separate enums in the document, which is right for
 * storage and wrong for a picker: every effect used to be offered under every
 * family, so "entrance · disappear" was buildable and *fading out* — `fade`
 * under `exit` — was invisible.
 */
describe("AnimationPanel — effects belong to a family", () => {
  const oneAnim = () => {
    const orb = state().addPrimitive("shape", "pickup");
    state().addStep();
    const animId = state().addAnimation(0, orb)!;
    state().select([orb]);
    return animId;
  };

  it("calls a fade what it does: out for an exit, in for an entrance", () => {
    const animId = oneAnim();
    state().updateAnimation(0, animId, { kind: "exit" });
    const { rerender } = render(<AnimationPanel />);
    expect(
      screen.getByRole("option", { name: "fade out" }),
    ).toBeInTheDocument();

    state().updateAnimation(0, animId, { kind: "entrance" });
    rerender(<AnimationPanel />);
    expect(screen.getByRole("option", { name: "fade in" })).toBeInTheDocument();
  });

  it("only offers a family's own effects", () => {
    const animId = oneAnim();
    state().updateAnimation(0, animId, { kind: "emphasis", effect: "pulse" });
    render(<AnimationPanel />);

    const names = screen
      .getAllByRole("option")
      .map((o) => o.textContent)
      .filter((n) => n === "pulse" || n === "blink" || n === "move");
    expect(names).toEqual(["pulse", "blink"]);
  });

  it("moves the effect along when the family changes under it", () => {
    const animId = oneAnim(); // motion · move
    render(<AnimationPanel />);

    fireEvent.change(screen.getByTestId("anim-kind"), {
      target: { value: "exit" },
    });

    // "exit · move" would be a thing the engine has no meaning for.
    const anim = state().steps[0]!.animations.find((a) => a.id === animId)!;
    expect(anim).toMatchObject({ kind: "exit", effect: "fade" });
  });

  it("keeps an effect the family doesn't list rather than rewriting it", () => {
    const animId = oneAnim();
    // A combination from before the families existed.
    state().updateAnimation(0, animId, { kind: "exit", effect: "fly" });
    render(<AnimationPanel />);

    expect(screen.getByTestId("anim-effect")).toHaveValue("fly");
  });

  it("hides duration and easing for an effect that ignores them", () => {
    const animId = oneAnim();
    state().updateAnimation(0, animId, { kind: "exit", effect: "disappear" });
    render(<AnimationPanel />);

    // A control that does nothing is worse than no control.
    expect(screen.queryByTestId("anim-duration")).not.toBeInTheDocument();
    expect(screen.queryByTestId("anim-easing")).not.toBeInTheDocument();
    expect(screen.getByTestId("anim-instant")).toBeInTheDocument();
    // Delay still means something: *when* it happens.
    expect(screen.getByTestId("anim-delay")).toBeInTheDocument();
  });

  it("offers them again for a timed effect", () => {
    const animId = oneAnim();
    state().updateAnimation(0, animId, { kind: "exit", effect: "fade" });
    render(<AnimationPanel />);

    expect(screen.getByTestId("anim-duration")).toBeInTheDocument();
    expect(screen.getByTestId("anim-easing")).toBeInTheDocument();
  });
});
