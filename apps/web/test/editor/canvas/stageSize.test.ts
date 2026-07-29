import { describe, expect, it } from "vitest";
import { stageSize } from "../../../src/editor/canvas/useContainerSize";

// A 0×0 Konva stage gets a 0×0 buffer canvas, and Firefox throws
// `Passed-in canvas is empty` the moment a translucent fill+stroke shape draws
// through it — mid-commit, so the whole editor unmounts. The first frame is
// always unmeasured, so the clamp is what stands between a warm client-side
// navigation and that crash.
describe("stageSize — no stage is ever 0×0", () => {
  it("clamps an unmeasured container to one pixel", () => {
    expect(stageSize({ width: 0, height: 0 })).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("clamps each axis independently", () => {
    expect(stageSize({ width: 800, height: 0 })).toEqual({
      width: 800,
      height: 1,
    });
    expect(stageSize({ width: 0, height: 600 })).toEqual({
      width: 1,
      height: 600,
    });
  });

  it("passes a measured size through untouched", () => {
    expect(stageSize({ width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("clamps a collapsed panel's negative rounding to one pixel", () => {
    expect(stageSize({ width: -4, height: -4 })).toEqual({
      width: 1,
      height: 1,
    });
  });
});
