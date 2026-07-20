import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { sharpConverter } from "../../src/icons/imageConverter.js";

/**
 * These exercise the real `sharp` path (not a fake): conversion is the one part
 * of the pipeline where "it compiles" says nothing about "it produces a valid
 * WebP", so we generate a PNG and assert on the decoded output.
 */
describe("sharpConverter", () => {
  async function samplePng(w = 100, h = 80): Promise<Uint8Array> {
    const buf = await sharp({
      create: {
        width: w,
        height: h,
        channels: 4,
        background: { r: 200, g: 20, b: 20, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    return new Uint8Array(buf);
  }

  it("produces a square WebP at the requested size", async () => {
    const png = await samplePng();
    const webp = await sharpConverter().toWebp(png, 56);

    const meta = await sharp(Buffer.from(webp)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(56);
    expect(meta.height).toBe(56);
  });

  it("scales to the large variant too", async () => {
    const webp = await sharpConverter().toWebp(await samplePng(), 112);
    const meta = await sharp(Buffer.from(webp)).metadata();
    expect(meta.width).toBe(112);
    expect(meta.height).toBe(112);
  });

  it("rejects bytes that are not an image", async () => {
    await expect(
      sharpConverter().toWebp(new Uint8Array([1, 2, 3]), 56),
    ).rejects.toThrow();
  });
});
