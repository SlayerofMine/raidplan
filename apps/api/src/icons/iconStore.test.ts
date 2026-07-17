import { describe, expect, it, vi } from "vitest";
import { iconFilename, localIconStore } from "./iconStore.js";

describe("iconFilename", () => {
  it("is content- and size-addressed", () => {
    expect(iconFilename("deadbeef", 56)).toBe("deadbeef_56.webp");
  });
});

describe("localIconStore", () => {
  it("writes <hash>_<size>.webp and returns its public URL", async () => {
    const writeFileImpl = vi.fn(async () => {});
    const mkdirImpl = vi.fn(async () => {});
    const store = localIconStore({
      dir: "/data/icons",
      writeFileImpl,
      mkdirImpl,
    });

    const url = await store.put("abc123", 56, new Uint8Array([1, 2, 3]));

    expect(url).toBe("/icons/abc123_56.webp");
    expect(writeFileImpl).toHaveBeenCalledWith(
      "/data/icons/abc123_56.webp",
      expect.any(Uint8Array),
    );
  });

  it("honours a custom public path", async () => {
    const store = localIconStore({
      dir: "/d",
      publicPath: "/cdn/icons",
      writeFileImpl: async () => {},
      mkdirImpl: async () => {},
    });
    expect(await store.put("h", 112, new Uint8Array())).toBe(
      "/cdn/icons/h_112.webp",
    );
  });

  it("creates the directory once, not on every put", async () => {
    const mkdirImpl = vi.fn(async () => {});
    const store = localIconStore({
      dir: "/d",
      writeFileImpl: async () => {},
      mkdirImpl,
    });
    await store.put("a", 56, new Uint8Array());
    await store.put("b", 56, new Uint8Array());
    expect(mkdirImpl).toHaveBeenCalledTimes(1);
  });
});
