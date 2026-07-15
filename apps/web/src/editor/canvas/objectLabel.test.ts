import { describe, expect, it } from "vitest";
import { OBJECT_TYPES } from "@raidplan/shared";
import { labelLayout, LABEL_FONT_SIZE } from "./objectLabel";

describe("labelLayout", () => {
  it("gives a text object no standalone label (it *is* its label)", () => {
    expect(labelLayout("text", 40)).toBeNull();
  });

  it("places a token's label under the icon, clear of the artwork", () => {
    const layout = labelLayout("token", 64)!;
    expect(layout.y).toBeGreaterThanOrEqual(64);
    expect(layout.verticalAlign).toBe("top");
  });

  it("centres a shape's label inside the shape", () => {
    const layout = labelLayout("shape", 160)!;
    expect(layout).toMatchObject({
      y: 0,
      height: 160,
      verticalAlign: "middle",
    });
  });

  it("places an arrow's label above the line", () => {
    const layout = labelLayout("arrow", 24)!;
    expect(layout.y).toBeLessThan(0);
    expect(layout.y + layout.height).toBeLessThanOrEqual(0);
  });

  it("returns a layout for every object type except text", () => {
    // Regression guard: shapes and arrows silently dropped their label before.
    for (const type of OBJECT_TYPES) {
      const layout = labelLayout(type, 100);
      if (type === "text") expect(layout).toBeNull();
      else expect(layout).not.toBeNull();
    }
  });

  it("keeps the label box tall enough to fit the text", () => {
    for (const type of OBJECT_TYPES) {
      const layout = labelLayout(type, 100);
      if (layout) expect(layout.height).toBeGreaterThanOrEqual(LABEL_FONT_SIZE);
    }
  });

  it("tracks the object height so the label follows a resize", () => {
    expect(labelLayout("token", 64)!.y).toBeLessThan(
      labelLayout("token", 200)!.y,
    );
    expect(labelLayout("shape", 200)!.height).toBe(200);
  });
});
