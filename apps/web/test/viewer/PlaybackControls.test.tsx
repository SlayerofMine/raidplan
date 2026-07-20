import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PlaybackApi } from "../../src/anim/usePlayback";
import { PlaybackControls } from "../../src/viewer/PlaybackControls";

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

const renderControls = (api: PlaybackApi) =>
  render(
    <PlaybackControls playback={api} onFullscreen={vi.fn()} stepName="Pull" />,
  );

describe("PlaybackControls — transport", () => {
  it("toggles play and shows the matching affordance", () => {
    const api = playback();
    const { rerender } = renderControls(api);
    const toggle = screen.getByTestId("play-toggle");
    expect(toggle).toHaveAccessibleName("Play");
    fireEvent.click(toggle);
    expect(api.toggle).toHaveBeenCalledOnce();

    rerender(
      <PlaybackControls
        playback={playback({ isPlaying: true })}
        onFullscreen={vi.fn()}
        stepName="Pull"
      />,
    );
    expect(screen.getByTestId("play-toggle")).toHaveAccessibleName("Pause");
  });

  it("pins step navigation at the ends of the plan", () => {
    renderControls(playback({ stepIndex: 0 }));
    expect(screen.getByLabelText("Previous step")).toBeDisabled();
    expect(screen.getByLabelText("Next step")).toBeEnabled();

    renderControls(playback({ stepIndex: 2, stepCount: 3 }));
    expect(screen.getAllByLabelText("Next step")[1]).toBeDisabled();
  });

  it("disables play for a plan with no steps", () => {
    renderControls(playback({ stepCount: 0 }));
    expect(screen.getByTestId("play-toggle")).toBeDisabled();
    expect(screen.getByTestId("viewer-step")).toHaveTextContent("No steps");
  });

  it("scrubs to a position within the step", () => {
    const api = playback();
    renderControls(api);
    fireEvent.change(screen.getByTestId("scrub"), { target: { value: "0.4" } });
    expect(api.seek).toHaveBeenCalledWith(0.4);
  });
});
