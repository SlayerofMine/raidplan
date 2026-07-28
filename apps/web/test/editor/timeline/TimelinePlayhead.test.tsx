import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ICONS } from "@raidplan/shared";
import { useEditorStore } from "../../../src/store/editorStore";
import { usePlayhead } from "../../../src/editor/timeline/playhead";
import { TimelineChart } from "../../../src/editor/timeline/TimelineChart";

const state = () => useEditorStore.getState();
const head = () => usePlayhead.getState();
const iconId = ICONS[0]!.id;

/** One object with one 500ms move on slide 0 — the shortest real timeline. */
function seedOneAnimation() {
  const objectId = state().addIcon(iconId);
  const animId = state().addAnimation(0, objectId)!;
  return { objectId, animId };
}

const anim = (animId: string) =>
  state().slides[0]!.animations.find((a) => a.id === animId)!;

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  head().stop();
  // The driver hook owns this in the app; a chart on its own has no driver.
  head().setDurationMs(0);
});

describe("the timeline playhead", () => {
  it("shows nothing to scrub on a slide with no animations", () => {
    render(<TimelineChart slideIndex={0} />);
    expect(screen.queryByTestId("timeline-playhead")).not.toBeInTheDocument();
  });

  it("marks where the canvas is being shown", () => {
    seedOneAnimation();
    head().setDurationMs(500);
    head().seekMs(200);
    render(<TimelineChart slideIndex={0} />);

    expect(screen.getByTestId("timeline-playhead")).toHaveAttribute(
      "data-time-ms",
      "200",
    );
  });

  it("moves the marker as the playhead moves", () => {
    seedOneAnimation();
    head().setDurationMs(500);
    render(<TimelineChart slideIndex={0} />);

    act(() => head().seekMs(350));
    expect(screen.getByTestId("timeline-playhead")).toHaveAttribute(
      "data-time-ms",
      "350",
    );
  });

  it("only marks the slide being edited — no other chart can be the one on screen", () => {
    seedOneAnimation();
    state().addSlide(); // slide 1 is now current
    head().setDurationMs(500);
    render(<TimelineChart slideIndex={0} />);
    expect(screen.queryByTestId("timeline-playhead")).not.toBeInTheDocument();
  });

  describe("the scrub ruler", () => {
    it("reports the playhead as a slider over the slide's own length", () => {
      seedOneAnimation();
      head().setDurationMs(500);
      head().seekMs(125);
      render(<TimelineChart slideIndex={0} />);

      const ruler = screen.getByTestId("timeline-ruler");
      expect(ruler).toHaveAttribute("aria-valuemin", "0");
      expect(ruler).toHaveAttribute("aria-valuemax", "500");
      expect(ruler).toHaveAttribute("aria-valuenow", "125");
    });

    it("scrubs a frame at a time with the arrow keys, so the timeline is usable without a pointer", () => {
      seedOneAnimation();
      head().setDurationMs(500);
      render(<TimelineChart slideIndex={0} />);
      const ruler = screen.getByTestId("timeline-ruler");

      fireEvent.keyDown(ruler, { key: "ArrowRight" });
      expect(head().timeMs).toBeCloseTo(1000 / 60);

      fireEvent.keyDown(ruler, { key: "ArrowRight", shiftKey: true });
      expect(head().timeMs).toBeCloseTo((1000 / 60) * 11);
    });

    it("jumps to either end with Home and End", () => {
      seedOneAnimation();
      head().setDurationMs(500);
      render(<TimelineChart slideIndex={0} />);
      const ruler = screen.getByTestId("timeline-ruler");

      fireEvent.keyDown(ruler, { key: "End" });
      expect(head().timeMs).toBe(500);
      fireEvent.keyDown(ruler, { key: "Home" });
      expect(head().timeMs).toBe(0);
    });

    it("won't scrub past the start", () => {
      seedOneAnimation();
      head().setDurationMs(500);
      render(<TimelineChart slideIndex={0} />);

      fireEvent.keyDown(screen.getByTestId("timeline-ruler"), {
        key: "ArrowLeft",
      });
      expect(head().timeMs).toBe(0);
    });
  });

  describe("retiming while the playhead is live", () => {
    it("is refused, so a bar can't be dragged out from under the frame it is drawing", () => {
      const { animId } = seedOneAnimation();
      const before = anim(animId).delayMs;
      head().setDurationMs(500);
      head().seekMs(200);
      render(<TimelineChart slideIndex={0} />);

      fireEvent.keyDown(screen.getByTestId(`timeline-bar-${animId}`), {
        key: "ArrowRight",
      });
      expect(anim(animId).delayMs).toBe(before);
    });

    it("resumes once the transport stops", () => {
      const { animId } = seedOneAnimation();
      head().setDurationMs(500);
      head().seekMs(200);
      render(<TimelineChart slideIndex={0} />);

      act(() => head().stop());
      fireEvent.keyDown(screen.getByTestId(`timeline-bar-${animId}`), {
        key: "ArrowRight",
      });
      expect(anim(animId).delayMs).toBeGreaterThan(0);
    });
  });
});
