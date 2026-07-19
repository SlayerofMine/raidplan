import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ICONS } from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { TimelineChart } from "./TimelineChart";

const state = () => useEditorStore.getState();
const iconId = ICONS[0]!.id;

/** A one-object, one-step plan with a single move animation on step 0. */
function seedOneAnimation() {
  const objectId = state().addIcon(iconId);
  state().updateObject(objectId, { label: "Tank" });
  state().addStep();
  const animId = state().addAnimation(0, objectId)!;
  return { objectId, animId };
}

const anim = (animId: string) =>
  state().steps[0]!.animations.find((a) => a.id === animId)!;

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
});

describe("TimelineChart", () => {
  it("shows an empty hint for a step with no animations", () => {
    state().addStep();
    render(<TimelineChart stepIndex={0} />);
    expect(screen.getByTestId("timeline-empty-0")).toBeInTheDocument();
  });

  it("keeps the measured track mounted with no animations, so it is sized before the first bar exists (regression: fresh step → 0-width, undraggable bars until reload)", () => {
    state().addStep();
    render(<TimelineChart stepIndex={0} />);
    // The width-measuring wrapper must be present in the empty state; if it only
    // appeared alongside the first row it would never get observed.
    expect(screen.getByTestId("timeline-track-0")).toBeInTheDocument();
  });

  it("renders one row per animated object, labelled by the object", () => {
    const { objectId } = seedOneAnimation();
    render(<TimelineChart stepIndex={0} />);
    const row = screen.getByTestId(`timeline-row-${objectId}`);
    expect(row).toHaveTextContent("Tank");
  });

  it("labels the row by the object's Name, not its internal id", () => {
    const objectId = state().addIcon(iconId);
    state().updateObject(objectId, { name: "Off-tank" });
    state().addStep();
    state().addAnimation(0, objectId);
    render(<TimelineChart stepIndex={0} />);
    const row = screen.getByTestId(`timeline-row-${objectId}`);
    expect(row).toHaveTextContent("Off-tank");
    expect(row).not.toHaveTextContent(objectId);
  });

  it("renders a bar whose label reports effect, delay and duration", () => {
    const { animId } = seedOneAnimation();
    render(<TimelineChart stepIndex={0} />);
    const bar = screen.getByTestId(`timeline-bar-${animId}`);
    // Defaults from addAnimation: move, delay 0, duration 500.
    expect(bar).toHaveAttribute("aria-label", expect.stringContaining("move"));
    expect(bar).toHaveAttribute("aria-label", expect.stringContaining("500ms"));
  });

  it("selects the object when a bar is clicked", () => {
    const { objectId, animId } = seedOneAnimation();
    state().clearSelection();
    render(<TimelineChart stepIndex={0} />);
    fireEvent.click(screen.getByTestId(`timeline-bar-${animId}`));
    expect(state().selectedIds).toEqual([objectId]);
  });

  it("nudges delay with the keyboard on the bar body (a11y, no pixels)", () => {
    const { animId } = seedOneAnimation();
    render(<TimelineChart stepIndex={0} />);
    const bar = screen.getByTestId(`timeline-bar-${animId}`);

    expect(anim(animId).delayMs).toBe(0);
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(anim(animId).delayMs).toBe(50);
    fireEvent.keyDown(bar, { key: "ArrowRight", shiftKey: true });
    expect(anim(animId).delayMs).toBe(300);
    // Can't go below zero.
    fireEvent.keyDown(bar, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(bar, { key: "ArrowLeft", shiftKey: true });
    expect(anim(animId).delayMs).toBe(0);
  });

  it("nudges duration with the keyboard on the resize handle", () => {
    const { animId } = seedOneAnimation();
    render(<TimelineChart stepIndex={0} />);
    const handle = screen.getByTestId(`timeline-handle-${animId}`);

    expect(anim(animId).durationMs).toBe(500);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(anim(animId).durationMs).toBe(550);
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(anim(animId).durationMs).toBe(300);
    // Floors at the minimum duration rather than reaching zero.
    for (let i = 0; i < 10; i++)
      fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(anim(animId).durationMs).toBe(50);
  });

  it("gives concurrent animations on one object their own lane", () => {
    const objectId = state().addIcon(iconId);
    state().addStep();
    state().addAnimation(0, objectId);
    const secondId = state().addAnimation(0, objectId)!;
    state().updateAnimation(0, secondId, { trigger: "withPrevious" });

    render(<TimelineChart stepIndex={0} />);
    // Still one object row, but both bars are present (stacked in lanes).
    expect(screen.getAllByTestId(`timeline-row-${objectId}`)).toHaveLength(1);
    expect(screen.getByTestId(`timeline-bar-${secondId}`)).toBeInTheDocument();
  });
});
