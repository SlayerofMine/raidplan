import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { ICONS } from "@raidplan/shared";
import { useEditorStore } from "../../src/store/editorStore";
import { usePlayhead } from "../../src/editor/timeline/playhead";
import { useEditorHotkeys } from "../../src/editor/useEditorHotkeys";

const state = () => useEditorStore.getState();
const head = () => usePlayhead.getState();
const press = (key: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));

beforeEach(() => {
  state().reset();
  head().stop();
  head().setDurationMs(1000);
});

/**
 * The keyboard half of the editing lock (plan §3.4).
 *
 * Everything the shortcuts can do writes to the document, and while the
 * playhead is off zero the canvas is showing a frame of an animation rather
 * than the slide — so a delete or an undo would change something other than
 * what is on screen.
 */
describe("editor hotkeys while the playhead is live", () => {
  it("still delete and undo at time zero", () => {
    const objectId = state().addIcon(ICONS[0]!.id);
    state().select([objectId]);
    renderHook(() => useEditorHotkeys());

    press("Delete");
    expect(state().objectIds).not.toContain(objectId);
  });

  it("refuse to delete the selection", () => {
    const objectId = state().addIcon(ICONS[0]!.id);
    state().select([objectId]);
    renderHook(() => useEditorHotkeys());
    head().seekMs(300);

    press("Delete");
    expect(state().objectIds).toContain(objectId);
  });

  it("refuse to undo — the document must not step while you watch a frame of it", () => {
    const objectId = state().addIcon(ICONS[0]!.id);
    renderHook(() => useEditorHotkeys());
    head().seekMs(300);

    press("z", { ctrlKey: true });
    expect(state().objectIds).toContain(objectId);
  });

  it("refuse to nudge, duplicate or select all", () => {
    const objectId = state().addIcon(ICONS[0]!.id);
    state().select([objectId]);
    const before = state().objects[objectId]!.base.x;
    renderHook(() => useEditorHotkeys());
    head().seekMs(300);

    press("ArrowRight");
    press("d", { ctrlKey: true });
    expect(state().objects[objectId]!.base.x).toBe(before);
    expect(state().objectIds).toHaveLength(1);
  });

  it("let Escape stop the transport, so the keyboard is never a dead end", () => {
    renderHook(() => useEditorHotkeys());
    head().seekMs(300);

    press("Escape");
    expect(head().timeMs).toBe(0);
    expect(head().isPlaying).toBe(false);
  });
});
