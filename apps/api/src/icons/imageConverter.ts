import type { ImageConverter } from "./types.js";

/**
 * The production image converter, backed by `sharp` (plan §11.1 "Convert to
 * WebP … (sharp)"; chosen for arm64 prebuilds).
 *
 * `sharp` is imported **lazily** so it loads only when a real conversion
 * happens: unit tests inject a fake converter and never pull the native
 * binary, keeping the suite hermetic and fast. `fit: "cover"` gives a square
 * thumbnail without distortion.
 */
export function sharpConverter(): ImageConverter {
  return {
    async toWebp(bytes: Uint8Array, size: number): Promise<Uint8Array> {
      const { default: sharp } = await import("sharp");
      const out = await sharp(Buffer.from(bytes))
        .resize(size, size, { fit: "cover" })
        .webp({ quality: 90 })
        .toBuffer();
      return new Uint8Array(out);
    },
  };
}
