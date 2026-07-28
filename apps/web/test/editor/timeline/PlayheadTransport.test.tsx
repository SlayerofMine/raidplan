import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { usePlayhead } from "../../../src/editor/timeline/playhead";
import { PlayheadTransport } from "../../../src/editor/timeline/PlayheadTransport";

const head = () => usePlayhead.getState();

beforeEach(() => {
  head().stop();
  head().setDurationMs(0);
  head().setSpeed(1);
  head().setLoop(false);
});

describe("PlayheadTransport", () => {
  it("offers nothing to play on a slide with no animations", () => {
    render(<PlayheadTransport />);
    expect(screen.getByTestId("playhead-play")).toBeDisabled();
    expect(screen.getByTestId("playhead-stop")).toBeDisabled();
  });

  it("plays and pauses from one button", () => {
    head().setDurationMs(1000);
    render(<PlayheadTransport />);

    fireEvent.click(screen.getByTestId("playhead-play"));
    expect(head().isPlaying).toBe(true);
    expect(screen.getByTestId("playhead-play")).toHaveAttribute(
      "aria-label",
      "Pause",
    );

    fireEvent.click(screen.getByTestId("playhead-play"));
    expect(head().isPlaying).toBe(false);
  });

  it("stops back to the start, which is what unlocks editing again", () => {
    head().setDurationMs(1000);
    head().seekMs(700);
    render(<PlayheadTransport />);

    fireEvent.click(screen.getByTestId("playhead-stop"));
    expect(head().timeMs).toBe(0);
    expect(head().isPlaying).toBe(false);
  });

  it("toggles looping, and says so", () => {
    render(<PlayheadTransport />);
    const loop = screen.getByTestId("playhead-loop");
    expect(loop).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(loop);
    expect(head().loop).toBe(true);
    expect(loop).toHaveAttribute("aria-pressed", "true");
  });

  it("changes the playback rate", () => {
    render(<PlayheadTransport />);
    fireEvent.change(screen.getByTestId("playhead-speed"), {
      target: { value: "0.25" },
    });
    expect(head().speed).toBe(0.25);
  });

  it("reads out where the playhead is within the slide", () => {
    head().setDurationMs(2400);
    head().seekMs(600);
    render(<PlayheadTransport />);
    expect(screen.getByTestId("playhead-time")).toHaveTextContent(
      "0.60s / 2.40s",
    );
  });
});
