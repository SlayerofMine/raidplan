import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PlaybackApi } from "../anim/usePlayback";
import { PlaybackControls } from "./PlaybackControls";

function playback(over: Partial<PlaybackApi> = {}): PlaybackApi {
  return {
    stepIndex: 0,
    isPlaying: false,
    progress: 0,
    stepCount: 3,
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    restart: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    goTo: vi.fn(),
    seek: vi.fn(),
    triggerClick: vi.fn(),
    clickableObjectIds: [],
    ...over,
  };
}

const recording = (
  over: Partial<
    Parameters<typeof PlaybackControls>[0]["recording"] & object
  > = {},
) => ({
  isRecording: false,
  supported: true,
  toggle: vi.fn(),
  ...over,
});

describe("PlaybackControls — recording", () => {
  it("has no record button when recording isn't wired up", () => {
    render(
      <PlaybackControls
        playback={playback()}
        onFullscreen={vi.fn()}
        stepName="Pull"
      />,
    );
    expect(screen.queryByTestId("record-toggle")).not.toBeInTheDocument();
  });

  it("starts a recording when clicked", () => {
    const rec = recording();
    render(
      <PlaybackControls
        playback={playback()}
        onFullscreen={vi.fn()}
        stepName="Pull"
        recording={rec}
      />,
    );
    const button = screen.getByTestId("record-toggle");
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(rec.toggle).toHaveBeenCalledOnce();
  });

  it("reads as pressed, and offers to stop, while recording", () => {
    render(
      <PlaybackControls
        playback={playback()}
        onFullscreen={vi.fn()}
        stepName="Pull"
        recording={recording({ isRecording: true })}
      />,
    );
    const button = screen.getByTestId("record-toggle");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAccessibleName("Stop recording");
  });

  it("is disabled, with a reason, where WebM can't be recorded", () => {
    // Safari records MP4, not WebM — the button explains itself rather than
    // failing when pressed.
    render(
      <PlaybackControls
        playback={playback()}
        onFullscreen={vi.fn()}
        stepName="Pull"
        recording={recording({ supported: false })}
      />,
    );
    const button = screen.getByTestId("record-toggle");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      expect.stringContaining("can't record WebM"),
    );
  });

  it("is disabled when the plan has no steps to record", () => {
    render(
      <PlaybackControls
        playback={playback({ stepCount: 0 })}
        onFullscreen={vi.fn()}
        stepName=""
        recording={recording()}
      />,
    );
    expect(screen.getByTestId("record-toggle")).toBeDisabled();
  });
});
