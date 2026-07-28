import { beforeEach, describe, expect, it } from "vitest";
import {
  isPlaybackLocked,
  selectPlaybackLocked,
  usePlayhead,
} from "../../../src/editor/timeline/playhead";

const head = () => usePlayhead.getState();

beforeEach(() => {
  // A module singleton: reset the transport, not the whole store, so the
  // actions stay bound.
  head().stop();
  head().setDurationMs(0);
  head().setSpeed(1);
  head().setLoop(false);
});

describe("playhead transport", () => {
  it("starts nothing on a slide with no animations, so the editor can't lock itself out", () => {
    head().play();
    expect(head().isPlaying).toBe(false);
    expect(isPlaybackLocked()).toBe(false);
  });

  it("plays and pauses, keeping the time where the pause left it", () => {
    head().setDurationMs(1000);
    head().play();
    expect(head().isPlaying).toBe(true);

    head().seekMs(400);
    head().pause();
    expect(head().isPlaying).toBe(false);
    expect(head().timeMs).toBe(400);
  });

  it("toggles between play and pause", () => {
    head().setDurationMs(1000);
    head().toggle();
    expect(head().isPlaying).toBe(true);
    head().toggle();
    expect(head().isPlaying).toBe(false);
  });

  it("stops back to the top, which is the only editable moment", () => {
    head().setDurationMs(1000);
    head().seekMs(600);
    head().play();

    head().stop();
    expect(head().timeMs).toBe(0);
    expect(head().isPlaying).toBe(false);
    expect(isPlaybackLocked()).toBe(false);
  });

  it("starts over when play is pressed at the very end", () => {
    head().setDurationMs(1000);
    head().seekMs(1000);
    head().play();
    expect(head().timeMs).toBe(0);
    expect(head().isPlaying).toBe(true);
  });

  it("clamps a seek to the slide", () => {
    head().setDurationMs(1000);
    head().seekMs(-50);
    expect(head().timeMs).toBe(0);
    head().seekMs(9999);
    expect(head().timeMs).toBe(1000);
  });

  it("pulls the playhead back inside a slide that has just been shortened (regression: retiming a bar could strand it past the end, locking the editor with nothing to scrub back through)", () => {
    head().setDurationMs(1000);
    head().seekMs(900);
    head().setDurationMs(400);
    expect(head().timeMs).toBe(400);
  });
});

describe("the editing lock", () => {
  it("is off at time zero, where what you see is what is stored", () => {
    expect(selectPlaybackLocked(usePlayhead.getState())).toBe(false);
  });

  it("is on at any other moment, paused or not — a paused frame is still a frame", () => {
    head().setDurationMs(1000);
    head().seekMs(1);
    expect(head().isPlaying).toBe(false);
    expect(isPlaybackLocked()).toBe(true);
  });

  it("is on while playing, even before the first frame has advanced", () => {
    head().setDurationMs(1000);
    head().play();
    expect(head().timeMs).toBe(0);
    expect(isPlaybackLocked()).toBe(true);
  });
});
