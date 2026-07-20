import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  clientIp,
  FixedWindowRateLimiter,
  rateLimit,
} from "../../src/middleware/rateLimit.js";

describe("FixedWindowRateLimiter", () => {
  it("allows up to the limit, then denies within the window", () => {
    const t = 1000;
    const limiter = new FixedWindowRateLimiter(3, 1000, () => t);

    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);
    const denied = limiter.check("ip");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(1000);
  });

  it("tracks each key independently", () => {
    const t = 0;
    const limiter = new FixedWindowRateLimiter(1, 1000, () => t);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true); // different key, own budget
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("resets when the window elapses", () => {
    let t = 0;
    const limiter = new FixedWindowRateLimiter(1, 1000, () => t);
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(false);

    t = 1000; // window boundary
    expect(limiter.check("ip").allowed).toBe(true);
  });
});

describe("clientIp", () => {
  const ipFrom = async (headers: Record<string, string>) => {
    const app = new Hono();
    app.get("/", (c) => c.text(clientIp(c)));
    return (await app.request("/", { headers })).text();
  };

  it("takes the first hop of X-Forwarded-For", async () => {
    expect(await ipFrom({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })).toBe(
      "1.2.3.4",
    );
  });

  it("falls back to X-Real-IP, then a dev constant", async () => {
    expect(await ipFrom({ "x-real-ip": "9.9.9.9" })).toBe("9.9.9.9");
    expect(await ipFrom({})).toBe("local");
  });
});

describe("rateLimit middleware", () => {
  it("passes through until the limit, then 429s with Retry-After", async () => {
    const t = 0;
    const limiter = new FixedWindowRateLimiter(1, 5000, () => t);
    const app = new Hono();
    // Constant key so the test doesn't depend on request IP.
    app.post(
      "/x",
      rateLimit(limiter, () => "k"),
      (c) => c.text("ok"),
    );

    expect((await app.request("/x", { method: "POST" })).status).toBe(200);
    const limited = await app.request("/x", { method: "POST" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("5");
  });
});
