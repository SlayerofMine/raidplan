import { describe, expect, it } from "vitest";
import {
  ICON_CATALOG_CATEGORIES,
  IconCatalogEntrySchema,
  IconCatalogPageSchema,
  IconCatalogQuerySchema,
} from "./iconCatalog.js";

describe("IconCatalogEntrySchema", () => {
  it("accepts a well-formed entry", () => {
    const entry = {
      id: "spell_fire_fireball02",
      displayName: "Fireball",
      category: "spell" as const,
      url56: "/icons/abc123_56.webp",
      url112: "/icons/abc123_112.webp",
    };
    expect(IconCatalogEntrySchema.parse(entry)).toEqual(entry);
  });

  it("rejects an unknown category — the palette's chips are a closed set", () => {
    expect(() =>
      IconCatalogEntrySchema.parse({
        id: "x",
        displayName: "X",
        category: "mount",
        url56: "/icons/x_56.webp",
        url112: "/icons/x_112.webp",
      }),
    ).toThrow();
  });

  it("rejects an empty id — a plan must be able to reference it", () => {
    expect(() =>
      IconCatalogEntrySchema.parse({
        id: "",
        displayName: "X",
        category: "misc",
        url56: "/icons/x_56.webp",
        url112: "/icons/x_112.webp",
      }),
    ).toThrow();
  });
});

describe("IconCatalogPageSchema", () => {
  it("treats a null cursor as the end of the feed", () => {
    const page = IconCatalogPageSchema.parse({ items: [], nextCursor: null });
    expect(page.nextCursor).toBeNull();
  });
});

describe("IconCatalogQuerySchema", () => {
  it("trims the query and leaves an all-icons request empty", () => {
    expect(IconCatalogQuerySchema.parse({ query: "  fire  " })).toEqual({
      query: "fire",
    });
    expect(IconCatalogQuerySchema.parse({})).toEqual({});
  });

  it("rejects an over-long query rather than scanning on it", () => {
    expect(() =>
      IconCatalogQuerySchema.parse({ query: "x".repeat(65) }),
    ).toThrow();
  });

  it("every category is a non-empty slug", () => {
    for (const category of ICON_CATALOG_CATEGORIES) {
      expect(category).toMatch(/^[a-z]+$/);
    }
  });
});
