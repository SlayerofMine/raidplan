import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client.js";
import { users } from "./db/schema.js";
import { createTestDb } from "./db/testDb.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig({ NODE_ENV: "test" });
let db: Db;
let close: () => void;

beforeEach(() => {
  ({ db, close } = createTestDb());
  db.insert(users).values({ id: "u1", discordId: "d1", name: "W" }).run();
});
afterEach(() => close());

/** The app, driven as a given user (or anonymously). */
const appAs = (userId: string | null) =>
  createApp({ db, config, getUserId: () => userId });

describe("health", () => {
  it("GET /healthz reports ok and whether auth is configured", async () => {
    const res = await appAs(null).request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; authEnabled: boolean };
    expect(body.status).toBe("ok");
    expect(body.authEnabled).toBe(false);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await appAs(null).request("/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("tRPC over HTTP", () => {
  it("serves a query for an authenticated caller", async () => {
    const res = await appAs("u1").request("/trpc/me.get");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { data: { userId: string } } };
    expect(body.result.data.userId).toBe("u1");
  });

  it("rejects an anonymous caller on a protected procedure", async () => {
    const res = await appAs(null).request("/trpc/me.get");
    // tRPC maps UNAUTHORIZED onto HTTP 401.
    expect(res.status).toBe(401);
  });

  it("creates and reads back a plan over HTTP", async () => {
    const app = appAs("u1");
    const created = await app.request("/trpc/plan.create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Over the wire",
        background: { assetId: "arena", width: 1600, height: 900 },
      }),
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as {
      result: { data: { id: string; slug: string } };
    };
    const { id, slug } = body.result.data;
    expect(slug).toMatch(/^[a-z2-9]{10}$/);

    const read = await app.request(
      `/trpc/plan.get?input=${encodeURIComponent(JSON.stringify({ id }))}`,
    );
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as {
      result: { data: { title: string } };
    };
    expect(readBody.result.data.title).toBe("Over the wire");
  });

  it("derives the viewer per request, so users can't read each other's plans", async () => {
    db.insert(users).values({ id: "u2", discordId: "d2", name: "Other" }).run();

    const created = await appAs("u1").request("/trpc/plan.create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        background: { assetId: "arena", width: 1600, height: 900 },
      }),
    });
    const { id } = (
      (await created.json()) as { result: { data: { id: string } } }
    ).result.data;

    const asOther = await appAs("u2").request(
      `/trpc/plan.get?input=${encodeURIComponent(JSON.stringify({ id }))}`,
    );
    expect(asOther.status).toBe(404);
  });
});
