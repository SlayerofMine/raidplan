import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ICONS } from "@raidplan/shared";
import { useEditorStore } from "../../../src/store/editorStore";
import { TimelineChart } from "../../../src/editor/timeline/TimelineChart";

const state = () => useEditorStore.getState();
const iconId = ICONS[0]!.id;

/** A one-object, one-slide plan with a single move animation on slide 0. */
function seedOneAnimation() {
  const objectId = state().addIcon(iconId);
  state().updateObject(objectId, { label: "Tank" });
  const animId = state().addAnimation(0, objectId)!;
  return { objectId, animId };
}

const anim = (animId: string) =>
  state().slides[0]!.animations.find((a) => a.id === animId)!;

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
});

describe("TimelineChart", () => {
  it("shows an empty hint for a slide with no animations", () => {
    render(<TimelineChart slideIndex={0} />);
    expect(screen.getByTestId("timeline-empty-0")).toBeInTheDocument();
  });

  it("keeps the measured track mounted with no animations, so it is sized before the first bar exists (regression: fresh slide → 0-width, undraggable bars until reload)", () => {
    render(<TimelineChart slideIndex={0} />);
    // The width-measuring wrapper must be present in the empty state; if it only
    // appeared alongside the first row it would never get observed.
    expect(screen.getByTestId("timeline-track-0")).toBeInTheDocument();
  });

  it("renders one row per animated object, labelled by the object", () => {
    const { objectId } = seedOneAnimation();
    render(<TimelineChart slideIndex={0} />);
    const row = screen.getByTestId(`timeline-row-${objectId}`);
    expect(row).toHaveTextContent("Tank");
  });

  it("labels the row by the object's Name, not its internal id", () => {
    const objectId = state().addIcon(iconId);
    state().updateObject(objectId, { name: "Off-tank" });
    state().addAnimation(0, objectId);
    render(<TimelineChart slideIndex={0} />);
    const row = screen.getByTestId(`timeline-row-${objectId}`);
    expect(row).toHaveTextContent("Off-tank");
    expect(row).not.toHaveTextContent(objectId);
  });

  it("renders a bar whose label reports effect, delay and duration", () => {
    const { animId } = seedOneAnimation();
    render(<TimelineChart slideIndex={0} />);
    const bar = screen.getByTestId(`timeline-bar-${animId}`);
    // Defaults from addAnimation: move, delay 0, duration 500.
    expect(bar).toHaveAttribute("aria-label", expect.stringContaining("move"));
    expect(bar).toHaveAttribute("aria-label", expect.stringContaining("500ms"));
  });

  it("selects the object when a bar is clicked", () => {
    const { objectId, animId } = seedOneAnimation();
    state().clearSelection();
    render(<TimelineChart slideIndex={0} />);
    fireEvent.click(screen.getByTestId(`timeline-bar-${animId}`));
    expect(state().selectedIds).toEqual([objectId]);
  });

  it("nudges delay with the keyboard on the bar body (a11y, no pixels)", () => {
    const { animId } = seedOneAnimation();
    render(<TimelineChart slideIndex={0} />);
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
    render(<TimelineChart slideIndex={0} />);
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
    state().addAnimation(0, objectId);
    const secondId = state().addAnimation(0, objectId)!;
    state().updateAnimation(0, secondId, { trigger: "withPrevious" });

    render(<TimelineChart slideIndex={0} />);
    // Still one object row, but both bars are present (stacked in lanes).
    expect(screen.getAllByTestId(`timeline-row-${objectId}`)).toHaveLength(1);
    expect(screen.getByTestId(`timeline-bar-${secondId}`)).toBeInTheDocument();
  });
});

/**
 * Three tokens with the first two grouped, all three animated together — the
 * shape of "select a group, hit Animate" (plan §18.1 / §18.9).
 */
function seedGroupOfTwoPlusOne() {
  const a = state().addIcon(iconId);
  const b = state().addIcon(iconId);
  const c = state().addIcon(iconId);
  state().select([a, b]);
  state().groupSelected();
  const groupId = state().objects[a]!.groupId!;
  state().renameGroup(groupId, "Melee");

  state().selectOnly([a, b, c]);
  const animIds = state().animateSelection(0);
  const animOf = (objectId: string) =>
    state().slides[0]!.animations.find((x) => x.objectId === objectId)!.id;
  return { a, b, c, groupId, animIds, animOf };
}

describe("TimelineChart groups", () => {
  it("gives a group one row under its name, not one row per member", () => {
    const { a, b, c, groupId } = seedGroupOfTwoPlusOne();
    render(<TimelineChart slideIndex={0} />);

    const groupRow = screen.getByTestId(`timeline-row-group-${groupId}`);
    expect(groupRow).toHaveTextContent("Melee");
    // The members are inside the group's row, not rows of their own.
    expect(screen.queryByTestId(`timeline-row-${a}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`timeline-row-${b}`)).not.toBeInTheDocument();
    // The ungrouped object still gets its own.
    expect(screen.getByTestId(`timeline-row-${c}`)).toBeInTheDocument();
  });

  it("falls back to 'Group' when the group has no name", () => {
    const { groupId } = seedGroupOfTwoPlusOne();
    state().renameGroup(groupId, "");
    render(<TimelineChart slideIndex={0} />);
    expect(
      screen.getByTestId(`timeline-row-group-${groupId}`),
    ).toHaveTextContent("Group");
  });

  it("draws the members' identical animations as a single bar", () => {
    const { a, b, animOf } = seedGroupOfTwoPlusOne();
    render(<TimelineChart slideIndex={0} />);

    const bar = screen.getByTestId(`timeline-bar-${animOf(a)}`);
    expect(bar).toHaveAttribute("data-objects", "2");
    expect(bar).toHaveAttribute(
      "aria-label",
      expect.stringContaining("2 objects"),
    );
    // The second member has no bar of its own — it *is* this one.
    expect(
      screen.queryByTestId(`timeline-bar-${animOf(b)}`),
    ).not.toBeInTheDocument();
  });

  it("retimes every member from the one bar, in a single action", () => {
    const { a, b, animOf } = seedGroupOfTwoPlusOne();
    render(<TimelineChart slideIndex={0} />);

    fireEvent.keyDown(screen.getByTestId(`timeline-bar-${animOf(a)}`), {
      key: "ArrowRight",
    });
    expect(anim(animOf(a)).delayMs).toBe(50);
    expect(anim(animOf(b)).delayMs).toBe(50);

    fireEvent.keyDown(screen.getByTestId(`timeline-handle-${animOf(a)}`), {
      key: "ArrowRight",
    });
    expect(anim(animOf(a)).durationMs).toBe(550);
    expect(anim(animOf(b)).durationMs).toBe(550);
  });

  it("splits a member's bar out of the group's the moment its timing differs", () => {
    const { a, b, animOf } = seedGroupOfTwoPlusOne();
    state().updateAnimation(0, animOf(b), { delayMs: 200 });
    render(<TimelineChart slideIndex={0} />);

    // Still one row — but two bars in it, since they no longer agree.
    const first = screen.getByTestId(`timeline-bar-${animOf(a)}`);
    const second = screen.getByTestId(`timeline-bar-${animOf(b)}`);
    expect(first).toHaveAttribute("data-objects", "1");
    expect(second).toHaveAttribute("data-objects", "1");
  });

  it("selects the whole group from the row's label", () => {
    const { a, b, groupId } = seedGroupOfTwoPlusOne();
    state().clearSelection();
    render(<TimelineChart slideIndex={0} />);

    fireEvent.click(screen.getByTestId(`timeline-row-group-${groupId}`));
    expect([...state().selectedIds].sort()).toEqual([a, b].sort());
  });

  it("treats a group worn down to one member as the object it is", () => {
    const { a, b, groupId } = seedGroupOfTwoPlusOne();
    // One member gone while the other still carries the `groupId` — a group of
    // one, which `pruneGroups` dissolves but the chart must not depend on it.
    useEditorStore.setState((s) => ({
      objects: Object.fromEntries(
        Object.entries(s.objects).filter(([id]) => id !== b),
      ),
      objectIds: s.objectIds.filter((id) => id !== b),
      slides: s.slides.map((slide) => ({
        ...slide,
        animations: slide.animations.filter((x) => x.objectId !== b),
      })),
    }));

    render(<TimelineChart slideIndex={0} />);
    expect(
      screen.queryByTestId(`timeline-row-group-${groupId}`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(`timeline-row-${a}`)).toBeInTheDocument();
  });
});
