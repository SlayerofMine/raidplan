import { describe, expect, it } from "vitest";
import { getIconById, ICONS } from "./icons";

describe("icon manifest", () => {
  it("ships a small hardcoded set of markers", () => {
    expect(ICONS.length).toBe(8);
  });

  it("has unique ids", () => {
    const ids = new Set(ICONS.map((i) => i.id));
    expect(ids.size).toBe(ICONS.length);
  });

  it("exposes each icon as an svg data URI", () => {
    for (const icon of ICONS) {
      expect(icon.src.startsWith("data:image/svg+xml,")).toBe(true);
    }
  });

  it("getIconById resolves known ids and misses unknown ones", () => {
    expect(getIconById(ICONS[0]!.id)?.id).toBe(ICONS[0]!.id);
    expect(getIconById("does-not-exist")).toBeUndefined();
  });
});
