import { describe, expect, it } from "vitest";
import {
  BACKGROUNDS,
  DEFAULT_BACKGROUND,
  getBackgroundDef,
  getBackgroundSrc,
  isUploadedAsset,
  toBackground,
  UPLOAD_ASSET_PREFIX,
} from "./backgrounds.js";

describe("bundled maps", () => {
  it("ships a set with unique ids and real dimensions", () => {
    expect(BACKGROUNDS.length).toBeGreaterThan(0);
    expect(new Set(BACKGROUNDS.map((b) => b.assetId)).size).toBe(
      BACKGROUNDS.length,
    );
    for (const b of BACKGROUNDS) {
      expect(b.width).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(0);
      expect(b.src.startsWith("data:image/svg+xml,")).toBe(true);
    }
  });

  it("resolves a bundled map to its inline artwork", () => {
    expect(getBackgroundSrc("arena")?.startsWith("data:image/svg+xml,")).toBe(
      true,
    );
    expect(getBackgroundDef("arena")?.name).toBe("Arena");
  });

  it("has a default that is one of the bundled maps", () => {
    expect(getBackgroundDef(DEFAULT_BACKGROUND.assetId)).toBeDefined();
  });

  it("projects a definition onto the document's Background shape", () => {
    expect(toBackground(BACKGROUNDS[0]!)).toEqual({
      assetId: BACKGROUNDS[0]!.assetId,
      width: BACKGROUNDS[0]!.width,
      height: BACKGROUNDS[0]!.height,
    });
  });
});

describe("uploaded maps", () => {
  const uploaded = `${UPLOAD_ASSET_PREFIX}0f3c8b1a-2d4e-4f6a-9b8c-1d2e3f4a5b6c.png`;

  it("recognises an upload by its path", () => {
    expect(isUploadedAsset(uploaded)).toBe(true);
    expect(isUploadedAsset("arena")).toBe(false);
  });

  it("resolves an upload to the path that serves it", () => {
    // The id *is* the URL, so a plan carries everything needed to draw it.
    expect(getBackgroundSrc(uploaded)).toBe(uploaded);
  });

  it("has no bundled definition — it isn't in the map list", () => {
    expect(getBackgroundDef(uploaded)).toBeUndefined();
  });
});

describe("unknown maps", () => {
  it("resolves to undefined rather than throwing", () => {
    // A plan referencing a deleted map should still draw its objects on the
    // empty floor, not fail outright.
    expect(getBackgroundSrc("no-such-map")).toBeUndefined();
    expect(getBackgroundSrc("")).toBeUndefined();
  });

  it("does not treat a lookalike path as an upload", () => {
    expect(getBackgroundSrc("uploads/x.png")).toBeUndefined(); // no leading /
    expect(getBackgroundSrc("/upload/x.png")).toBeUndefined(); // singular
  });
});
