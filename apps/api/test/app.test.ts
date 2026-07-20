import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import { createTestDb } from "../src/db/testDb.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

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

  it("exposes no dev-login route unless DEV_AUTH is on", async () => {
    // The module-level `config` has DEV_AUTH unset.
    const res = await appAs(null).request("/api/dev/login?userId=u1");
    expect(res.status).toBe(404);
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

describe("dev auth (DEV_AUTH)", () => {
  // A real app (no injected getUserId), so the cookie resolver actually runs.
  const devConfig = loadConfig({ NODE_ENV: "test", DEV_AUTH: "1" });
  const devApp = () => createApp({ db, config: devConfig });

  it("signs in via a cookie, with no Discord round-trip", async () => {
    const login = await devApp().request("/api/dev/login?userId=u1");
    expect(login.status).toBe(302);
    expect(login.headers.get("set-cookie")).toContain("dev_user=u1");

    const me = await devApp().request("/trpc/me.get", {
      headers: { cookie: "dev_user=u1" },
    });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { result: { data: { userId: string } } };
    expect(body.result.data.userId).toBe("u1");
  });

  it("materialises a brand-new user so their first write satisfies FKs", async () => {
    await devApp().request("/api/dev/login?userId=fresh&name=Fresh");
    const created = await devApp().request("/trpc/plan.create", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "dev_user=fresh" },
      body: JSON.stringify({
        background: { assetId: "arena", width: 1600, height: 900 },
      }),
    });
    expect(created.status).toBe(200);
  });

  it("is still anonymous without the cookie", async () => {
    const me = await devApp().request("/trpc/me.get");
    expect(me.status).toBe(401);
  });
});
