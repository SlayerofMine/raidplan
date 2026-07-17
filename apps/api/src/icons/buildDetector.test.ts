import { describe, expect, it, vi } from "vitest";
import {
  parseLatestBuild,
  staticBuildDetector,
  wagoBuildDetector,
} from "./buildDetector.js";

const wago = {
  wow: [
    { version: "12.1.0.68675", created_at: "2026-07-14 22:36:03" },
    { version: "12.1.0.68745", created_at: "2026-07-15 22:38:02" },
  ],
  wowt: [{ version: "12.2.0.70000", created_at: "2026-07-16 00:00:00" }],
};

describe("parseLatestBuild", () => {
  it("returns the newest version for the product by created_at", () => {
    expect(parseLatestBuild(wago, "wow")).toBe("12.1.0.68745");
  });

  it("does not leak another product's build", () => {
    expect(parseLatestBuild(wago, "wowt")).toBe("12.2.0.70000");
  });

  it("throws for an absent product rather than diffing against nothing", () => {
    expect(() => parseLatestBuild(wago, "classic")).toThrow(/classic/);
  });

  it("throws on a malformed response", () => {
    expect(() => parseLatestBuild({ wow: [] }, "wow")).toThrow();
    expect(() => parseLatestBuild(null, "wow")).toThrow();
  });
});

describe("wagoBuildDetector", () => {
  it("fetches and returns the current build", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(wago)),
    ) as unknown as typeof fetch;
    const build = await wagoBuildDetector({
      fetchImpl,
      url: "http://wago",
      product: "wow",
    }).currentBuild();
    expect(build).toBe("12.1.0.68745");
  });

  it("throws on a non-200", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(
      wagoBuildDetector({ fetchImpl }).currentBuild(),
    ).rejects.toThrow(/503/);
  });
});

describe("staticBuildDetector", () => {
  it("returns the fixed build", async () => {
    expect(await staticBuildDetector("1.2.3").currentBuild()).toBe("1.2.3");
  });
});
