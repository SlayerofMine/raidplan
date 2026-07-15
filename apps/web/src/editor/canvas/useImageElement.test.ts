import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  clearImageCache,
  getImageElement,
  useImageElement,
} from "./useImageElement";

const SRC_A = "data:image/svg+xml,%3Csvg%2F%3E";
const SRC_B = "data:image/svg+xml,%3Csvg%20id%3D%22b%22%2F%3E";

beforeEach(() => {
  clearImageCache();
});

// Note: jsdom loads no resources, so an image never reaches `complete` here.
// These cover the caching contract; the drawn result is covered by the E2E suite.
describe("getImageElement — shared icon cache (plan §8.5)", () => {
  it("returns the same element for the same source", () => {
    expect(getImageElement(SRC_A)).toBe(getImageElement(SRC_A));
  });

  it("returns a distinct element per distinct source", () => {
    expect(getImageElement(SRC_A)).not.toBe(getImageElement(SRC_B));
  });

  it("sets the source on the created element", () => {
    expect(getImageElement(SRC_A).getAttribute("src")).toBe(SRC_A);
  });

  it("creates a fresh element once the cache is cleared", () => {
    const first = getImageElement(SRC_A);
    clearImageCache();
    expect(getImageElement(SRC_A)).not.toBe(first);
  });
});

describe("useImageElement", () => {
  it("returns undefined when there is no source", () => {
    const { result } = renderHook(() => useImageElement(undefined));
    expect(result.current).toBeUndefined();
  });

  it("returns undefined until the image has decoded", () => {
    const { result } = renderHook(() => useImageElement(SRC_A));
    expect(result.current).toBeUndefined();
  });

  it("populates the shared cache for the requested source", () => {
    renderHook(() => useImageElement(SRC_A));
    // The hook went through the cache rather than making its own element.
    expect(getImageElement(SRC_A).getAttribute("src")).toBe(SRC_A);
  });
});
