import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";
import { useSoleSelection } from "../../src/store/useSoleSelection";

/**
 * The subscription behind the properties panel and the origin handles.
 *
 * Its whole reason for existing is memoisation. `selectObjectState` builds a
 * fresh object every call, and zustand v5 does no selector memoisation of its
 * own: React re-checks the snapshot whenever `getSnapshot`'s identity changes —
 * which is every render — and a result that isn't `Object.is`-equal schedules
 * another render. Unwrapped, that is not a slow render but a hard "Maximum
 * update depth exceeded", thrown the moment a single object is selected. So the
 * assertions here are about *identity*, and the render that survives at all.
 */
const state = () => useEditorStore.getState();

beforeEach(() => {
  state().reset();
  clearHistory();
});

describe("useSoleSelection", () => {
  it("settles instead of re-rendering itself forever", () => {
    const id = state().addPrimitive("shape", "rect");
    state().select([id]);

    // Unmemoized, mounting this throws before it can return anything.
    const { result } = renderHook(() => useSoleSelection());
    expect(result.current.object?.id).toBe(id);
    expect(result.current.state).toMatchObject({ w: 160, h: 160 });
  });

  it("hands back the same state object when nothing about it changed", () => {
    const id = state().addPrimitive("shape", "rect");
    state().select([id]);

    const { result, rerender } = renderHook(() => useSoleSelection());
    const first = result.current.state;
    rerender();
    // Re-rendering for any other reason must not look like a new state, or
    // every consumer downstream re-renders on every parent render.
    expect(result.current.state).toBe(first);

    // An edit to something else is still a store notification, and one that
    // re-renders this hook — the value it hands back must survive it.
    act(() => {
      state().addPrimitive("shape", "circle");
      state().select([id]);
    });
    expect(result.current.state).toBe(first);
  });

  it("hands back a new state object when the object is actually edited", () => {
    const id = state().addPrimitive("shape", "rect");
    state().select([id]);

    const { result } = renderHook(() => useSoleSelection());
    const first = result.current.state;
    act(() => state().updateObject(id, { w: 250 }));
    expect(result.current.state).not.toBe(first);
    expect(result.current.state).toMatchObject({ w: 250 });
  });

  it("is empty for a multi-selection — there is no single origin to move", () => {
    const a = state().addPrimitive("shape", "rect");
    const b = state().addPrimitive("shape", "circle");
    state().select([a, b]);

    const { result } = renderHook(() => useSoleSelection());
    expect(result.current.object).toBeUndefined();
    expect(result.current.state).toBeUndefined();
  });

  it("is empty with nothing selected", () => {
    state().addPrimitive("shape", "rect");
    state().clearSelection();

    const { result } = renderHook(() => useSoleSelection());
    expect(result.current.object).toBeUndefined();
    expect(result.current.state).toBeUndefined();
  });
});
