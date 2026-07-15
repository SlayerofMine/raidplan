import { describe, expect, it } from "vitest";
import { getIconById, ICON_CATEGORIES, ICONS, searchIcons } from "./icons.js";

describe("icon manifest", () => {
  it("covers every declared category", () => {
    for (const category of ICON_CATEGORIES) {
      expect(ICONS.some((i) => i.category === category)).toBe(true);
    }
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

  it("gives class and role tokens a tint for their colour ring", () => {
    for (const icon of ICONS) {
      if (icon.category === "class" || icon.category === "role") {
        expect(icon.tint).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("getIconById resolves known ids and misses unknown ones", () => {
    expect(getIconById(ICONS[0]!.id)?.id).toBe(ICONS[0]!.id);
    expect(getIconById("does-not-exist")).toBeUndefined();
  });
});

describe("searchIcons", () => {
  it("returns everything for an empty query", () => {
    expect(searchIcons("")).toHaveLength(ICONS.length);
  });

  it("filters by category", () => {
    const classes = searchIcons("", "class");
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.every((i) => i.category === "class")).toBe(true);
  });

  it("matches on name, case-insensitively", () => {
    expect(searchIcons("PALADIN").map((i) => i.id)).toContain("class-paladin");
  });

  it("matches on tags", () => {
    expect(searchIcons("heal").map((i) => i.id)).toContain("role-healer");
  });

  it("combines query and category", () => {
    // "tank" is a role, so searching it within classes must find nothing.
    expect(searchIcons("tank", "class")).toEqual([]);
    expect(searchIcons("tank", "role").map((i) => i.id)).toEqual(["role-tank"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(searchIcons("zzzz-no-such-icon")).toEqual([]);
  });
});
