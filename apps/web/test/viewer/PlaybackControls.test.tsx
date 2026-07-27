import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PlaybackApi } from "../../src/anim/usePlayback";
import { PlaybackControls } from "../../src/viewer/PlaybackControls";

function playback(over: Partial<PlaybackApi> = {}): PlaybackApi {
  return {
    slideIndex: 0,
    isPlaying: false,
    progress: 0,
    slideCount: 3,
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
    <PlaybackControls playback={api} onFullscreen={vi.fn()} slideName="Pull" />,
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
        slideName="Pull"
      />,
    );
    expect(screen.getByTestId("play-toggle")).toHaveAccessibleName("Pause");
  });

  it("pins slide navigation at the ends of the plan", () => {
    renderControls(playback({ slideIndex: 0 }));
    expect(screen.getByLabelText("Previous slide")).toBeDisabled();
    expect(screen.getByLabelText("Next slide")).toBeEnabled();

    renderControls(playback({ slideIndex: 2, slideCount: 3 }));
    expect(screen.getAllByLabelText("Next slide")[1]).toBeDisabled();
  });

  it("counts from one, so the label matches the slide strip", () => {
    renderControls(playback({ slideIndex: 1, slideCount: 4 }));
    expect(screen.getByTestId("viewer-slide")).toHaveTextContent("2 / 4");
  });

  it("scrubs to a position within the slide", () => {
    const api = playback();
    renderControls(api);
    fireEvent.change(screen.getByTestId("scrub"), { target: { value: "0.4" } });
    expect(api.seek).toHaveBeenCalledWith(0.4);
  });
});
