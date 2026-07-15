import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  readImageSize,
  sniffImage,
  validateUpload,
} from "./validateUpload.js";

/** A minimal PNG header with an IHDR declaring `width`×`height`. */
function pngBytes(width = 8, height = 4): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const jpegBytes = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const gifBytes = (w = 6, h = 3) => {
  const bytes = new Uint8Array(16);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  new DataView(bytes.buffer).setUint16(6, w, true);
  new DataView(bytes.buffer).setUint16(8, h, true);
  return bytes;
};
const webpBytes = () => {
  const bytes = new Uint8Array(16);
  bytes.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return bytes;
};
const utf8 = (s: string) => new TextEncoder().encode(s);

describe("sniffImage", () => {
  it("recognises the raster formats we accept", () => {
    expect(sniffImage(pngBytes())).toBe("png");
    expect(sniffImage(jpegBytes())).toBe("jpeg");
    expect(sniffImage(gifBytes())).toBe("gif");
    expect(sniffImage(webpBytes())).toBe("webp");
  });

  it("rejects anything else", () => {
    expect(sniffImage(utf8("hello"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  it("doesn't mistake a RIFF container for WebP", () => {
    const wav = new Uint8Array(16);
    wav.set([0x52, 0x49, 0x46, 0x46]); // RIFF…
    wav.set([0x57, 0x41, 0x56, 0x45], 8); // …WAVE
    expect(sniffImage(wav)).toBeNull();
  });
});

describe("validateUpload — the security boundary", () => {
  it("accepts a real image and reports its type from the content", () => {
    const result = validateUpload(pngBytes());
    expect(result).toMatchObject({
      ok: true,
      info: { kind: "png", mimeType: "image/png", extension: "png" },
    });
  });

  it("rejects SVG, however it's dressed up", () => {
    // SVG is a script-bearing document; serving one from our own origin would
    // be stored XSS. It is never accepted, regardless of what the client says.
    const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(validateUpload(svg).ok).toBe(false);
  });

  it("rejects HTML and scripts", () => {
    expect(validateUpload(utf8("<!doctype html><script>x</script>")).ok).toBe(
      false,
    );
    expect(validateUpload(utf8("#!/bin/sh\nrm -rf /")).ok).toBe(false);
  });

  it("is not fooled by a misleading extension or content-type", () => {
    // The bytes decide. A .png name over a text body is still not an image.
    expect(validateUpload(utf8("definitely not a png")).ok).toBe(false);
  });

  it("catches a polyglot that only *starts* looking wrong", () => {
    const trailing = new Uint8Array([...utf8("<script>"), ...pngBytes()]);
    expect(validateUpload(trailing).ok).toBe(false);
  });

  it("rejects an empty file", () => {
    const result = validateUpload(new Uint8Array());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty/i);
  });

  it("enforces the size limit", () => {
    const tooBig = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    tooBig.set(pngBytes());
    const result = validateUpload(tooBig);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/MB/);
  });

  it("accepts a file exactly at the limit", () => {
    const atLimit = new Uint8Array(MAX_UPLOAD_BYTES);
    atLimit.set(pngBytes());
    expect(validateUpload(atLimit).ok).toBe(true);
  });

  it("normalises jpeg's extension to jpg", () => {
    const result = validateUpload(jpegBytes());
    expect(result.ok && result.info.extension).toBe("jpg");
  });
});

describe("readImageSize", () => {
  it("reads PNG dimensions from the IHDR", () => {
    expect(readImageSize(pngBytes(1600, 900))).toEqual({
      width: 1600,
      height: 900,
    });
  });

  it("reads GIF dimensions (little-endian)", () => {
    expect(readImageSize(gifBytes(320, 200))).toEqual({
      width: 320,
      height: 200,
    });
  });

  it("returns null — not zero — when it can't tell", () => {
    // JPEG/WebP need a real parse. "Unknown" must not masquerade as 0×0.
    expect(readImageSize(jpegBytes())).toBeNull();
    expect(readImageSize(webpBytes())).toBeNull();
    expect(readImageSize(utf8("nope"))).toBeNull();
  });

  it("doesn't overrun a truncated header", () => {
    const truncated = pngBytes().subarray(0, 12);
    expect(() => readImageSize(truncated)).not.toThrow();
  });
});
