import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ICONS } from "@raidplan/shared";
import {
  clearSyncedIconUrls,
  registerSyncedIconUrl,
  resolveIconSrc,
  useIconSrc,
} from "../../src/editor/iconSrc";

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

describe("useIconSrc", () => {
  it("re-renders with the URL once a synced icon is registered", () => {
    // This is the crux of the reopen-a-plan fix: the token first renders with
    // no source, then must update when resolution arrives.
    const { result } = renderHook(() => useIconSrc("spell_fire_fireball02"));
    expect(result.current).toBeUndefined();

    act(() =>
      registerSyncedIconUrl("spell_fire_fireball02", "/icons/x_56.webp"),
    );
    expect(result.current).toBe("/icons/x_56.webp");
  });

  it("returns a bundled icon's src without any registration", () => {
    const bundled = ICONS[0]!;
    const { result } = renderHook(() => useIconSrc(bundled.id));
    expect(result.current).toBe(bundled.src);
  });
});
