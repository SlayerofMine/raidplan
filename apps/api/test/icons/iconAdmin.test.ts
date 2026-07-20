import { describe, expect, it } from "vitest";
import type { Viewer } from "../../src/auth/access.js";
import { isIconAdmin } from "../../src/icons/iconAdmin.js";

const viewer = (userId: string): Viewer => ({ userId, roles: {} });

describe("isIconAdmin", () => {
  it("admits a viewer whose id is on the allowlist", () => {
    expect(isIconAdmin(viewer("111"), ["111", "222"])).toBe(true);
  });

  it("refuses a viewer not on the allowlist", () => {
    expect(isIconAdmin(viewer("999"), ["111", "222"])).toBe(false);
  });

  it("refuses an anonymous visitor", () => {
    expect(isIconAdmin(null, ["111"])).toBe(false);
  });

  it("admits no one when the allowlist is empty — the safe default", () => {
    expect(isIconAdmin(viewer("111"), [])).toBe(false);
  });
});
