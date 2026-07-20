import { describe, expect, it, vi } from "vitest";
import {
  packImageSource,
  wowheadImageSource,
} from "../../src/icons/imageSource.js";

const entry = { name: "spell_fire_fireball02", fileDataId: 1234 };

describe("wowheadImageSource", () => {
  it("fetches <base>/<name>.jpg and returns the bytes", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG magic
    const fetchImpl = vi.fn(
      async () => new Response(bytes),
    ) as unknown as typeof fetch;
    const source = wowheadImageSource({ fetchImpl, base: "http://cdn" });

    expect(await source.fetchImage(entry)).toEqual(bytes);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://cdn/spell_fire_fireball02.jpg",
    );
    expect(source.name).toBe("wowhead");
  });

  it("returns null on a 404 so the run skips that icon", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    expect(
      await wowheadImageSource({ fetchImpl }).fetchImage(entry),
    ).toBeNull();
  });
});

describe("packImageSource", () => {
  it("reads <dir>/<name>.png when present", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const readFileImpl = vi.fn(async (path: string) => {
      if (path.endsWith(".png")) return bytes;
      throw new Error("ENOENT");
    });
    const source = packImageSource({ dir: "/pack", readFileImpl });

    expect(await source.fetchImage(entry)).toEqual(bytes);
    expect(readFileImpl).toHaveBeenCalledWith(
      "/pack/spell_fire_fireball02.png",
    );
    expect(source.name).toBe("pack");
  });

  it("falls through extensions and returns null when none exist", async () => {
    const readFileImpl = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    expect(
      await packImageSource({ dir: "/pack", readFileImpl }).fetchImage(entry),
    ).toBeNull();
    // png, jpg, jpeg, webp — four attempts before giving up.
    expect(readFileImpl).toHaveBeenCalledTimes(4);
  });
});
