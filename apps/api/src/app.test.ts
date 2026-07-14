import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("api app", () => {
  it("GET /healthz returns 200 with status ok", async () => {
    const app = createApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  it("returns 404 for unknown routes", async () => {
    const app = createApp();
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
  });
});
