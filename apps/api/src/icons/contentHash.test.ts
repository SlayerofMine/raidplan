import { describe, expect, it } from "vitest";
import { contentHash } from "./contentHash.js";

describe("contentHash", () => {
  it("is stable and 16 lowercase hex chars", () => {
    const hash = contentHash(new Uint8Array([1, 2, 3, 4]));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash(new Uint8Array([1, 2, 3, 4]))).toBe(hash);
  });

  it("differs when a single byte changes — it is the diff key", () => {
    const a = contentHash(new Uint8Array([1, 2, 3, 4]));
    const b = contentHash(new Uint8Array([1, 2, 3, 5]));
    expect(a).not.toBe(b);
  });
});
