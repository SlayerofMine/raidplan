import { describe, expect, it } from "vitest";
import { categorizeIconName, toDisplayName } from "../../src/icons/iconName.js";

describe("categorizeIconName", () => {
  it.each([
    ["spell_fire_fireball02", "spell"],
    ["ability_rogue_ambush", "ability"],
    ["inv_sword_04", "item"],
    ["item_gemcutting", "item"],
    ["achievement_boss_ragnaros", "achievement"],
    ["trade_alchemy", "trade"],
    ["classicon_warrior", "class"],
    ["class_druid", "class"],
    ["interface_button", "ui"],
  ])("buckets %s as %s from its leading token", (name, expected) => {
    expect(categorizeIconName(name).category).toBe(expected);
  });

  it("falls back to misc for an unknown prefix — categorisation is total", () => {
    expect(categorizeIconName("xyzzy_unknown_thing").category).toBe("misc");
  });

  it("handles a bare name with no separators", () => {
    const parsed = categorizeIconName("temp");
    expect(parsed.category).toBe("misc");
    expect(parsed.tags).toContain("temp");
  });

  it("does not throw on the empty string", () => {
    const parsed = categorizeIconName("");
    expect(parsed.category).toBe("misc");
    expect(parsed.displayName).toBe("");
  });

  it("derives de-numbered search tags and keeps the category searchable", () => {
    const { tags, category } = categorizeIconName("spell_fire_fireball02");
    expect(tags).toContain("fire");
    expect(tags).toContain("fireball"); // trailing 02 stripped
    // The category is always a tag, so a search for "spell" still hits it.
    expect(category).toBe("spell");
    expect(tags).toContain("spell");
  });

  it("drops a bucket prefix that is not the category from the tags", () => {
    // `inv` → category `item`; the raw prefix token itself is noise.
    const { tags } = categorizeIconName("inv_sword_04");
    expect(tags).toContain("sword");
    expect(tags).not.toContain("inv");
    expect(tags).not.toContain("04"); // pure number
    expect(tags).not.toContain(""); // no empty fragments
  });

  it("dedupes repeated tokens", () => {
    const { tags } = categorizeIconName("spell_fire_fire_fireball");
    expect(tags.filter((t) => t === "fire")).toHaveLength(1);
  });
});

describe("toDisplayName", () => {
  it("strips the prefix, splits digits and title-cases", () => {
    expect(toDisplayName("spell_fire_fireball02")).toBe("Fire Fireball 02");
    expect(toDisplayName("inv_sword_04")).toBe("Sword 04");
  });

  it("keeps the whole name when there is no prefix to strip", () => {
    expect(toDisplayName("temp")).toBe("Temp");
  });

  it("never returns an empty label for a non-empty name", () => {
    expect(toDisplayName("trade")).toBe("Trade");
  });
});
