import { beforeEach, describe, expect, it } from "vitest";
import { ICONS } from "@raidplan/shared";
import {
  clearSyncedIconUrls,
  registerSyncedIconUrl,
  resolveIconSrc,
} from "./iconSrc";

beforeEach(() => clearSyncedIconUrls());

describe("resolveIconSrc", () => {
  it("resolves a bundled icon from the shared manifest", () => {
    const bundled = ICONS[0]!;
    expect(resolveIconSrc(bundled.id)).toBe(bundled.src);
  });

  it("resolves a synced icon from its registered URL", () => {
    registerSyncedIconUrl("spell_fire_fireball02", "/icons/abc_56.webp");
    expect(resolveIconSrc("spell_fire_fireball02")).toBe("/icons/abc_56.webp");
  });

  it("prefers the bundled manifest over any synced registration", () => {
    const bundled = ICONS[0]!;
    registerSyncedIconUrl(bundled.id, "/icons/override.webp");
    expect(resolveIconSrc(bundled.id)).toBe(bundled.src);
  });

  it("returns undefined for an unknown id and for undefined", () => {
    expect(resolveIconSrc("does_not_exist")).toBeUndefined();
    expect(resolveIconSrc(undefined)).toBeUndefined();
  });
});
