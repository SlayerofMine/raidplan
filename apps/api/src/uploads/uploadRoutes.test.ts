import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig, type Config } from "../config.js";
import type { Db } from "../db/client.js";
import { assets, users } from "../db/schema.js";
import { createTestDb } from "../db/testDb.js";

let db: Db;
let close: () => void;
let uploadDir: string;
let config: Config;

beforeEach(async () => {
  ({ db, close } = createTestDb());
  db.insert(users).values({ id: "u1", discordId: "d1", name: "W" }).run();
  uploadDir = await mkdtemp(join(tmpdir(), "raidplans-uploads-"));
  config = loadConfig({ NODE_ENV: "test", UPLOAD_DIR: uploadDir });
});

afterEach(async () => {
  close();
  await rm(uploadDir, { recursive: true, force: true });
});

const appAs = (userId: string | null) =>
  createApp({ db, config, getUserId: () => userId });

function pngBytes(width = 16, height = 8): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** POST a file to /api/upload as `userId`. */
function upload(
  userId: string | null,
  bytes: Uint8Array,
  filename = "map.png",
  type = "image/png",
) {
  const form = new FormData();
  form.set("file", new File([bytes], filename, { type }));
  return appAs(userId).request("/api/upload", { method: "POST", body: form });
}

describe("POST /api/upload", () => {
  it("stores an image and records the asset", async () => {
    const res = await upload("u1", pngBytes(1600, 900));
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      id: string;
      url: string;
      width: number;
      height: number;
    };
    expect(body.url).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);
    // Dimensions are read from the file's own header.
    expect(body).toMatchObject({ width: 1600, height: 900 });

    const row = db.select().from(assets).get();
    expect(row).toMatchObject({ ownerId: "u1", kind: "background" });
  });

  it("requires a session — anonymous writes to our disk are not a feature", async () => {
    const res = await upload(null, pngBytes());
    expect(res.status).toBe(401);
    expect(db.select().from(assets).all()).toEqual([]);
  });

  it("rejects an SVG even when it claims to be a PNG", async () => {
    // The bytes decide, not the name or the Content-Type. An SVG served from
    // our origin would be stored XSS.
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const res = await upload("u1", svg, "innocent.png", "image/png");
    expect(res.status).toBe(400);
    expect(db.select().from(assets).all()).toEqual([]);
  });

  it("rejects a non-image", async () => {
    const res = await upload("u1", new TextEncoder().encode("not an image"));
    expect(res.status).toBe(400);
  });

  it("rejects an oversized file", async () => {
    const huge = new Uint8Array(5 * 1024 * 1024);
    huge.set(pngBytes());
    expect((await upload("u1", huge)).status).toBe(413);
  });

  it("rejects a request with no file", async () => {
    const res = await appAs("u1").request("/api/upload", {
      method: "POST",
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it("ignores the client's filename entirely", async () => {
    // A traversal attempt in the name must not reach the filesystem.
    const res = await upload("u1", pngBytes(), "../../../etc/passwd.png");
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect(url).not.toContain("..");
    expect(url).not.toContain("passwd");
    expect(url).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);
  });

  it("derives the extension from the content, not the name", async () => {
    const jpeg = new Uint8Array(32);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    const res = await upload("u1", jpeg, "actually.png", "image/png");
    const { url } = (await res.json()) as { url: string };
    expect(url.endsWith(".jpg")).toBe(true);
  });
});

describe("GET /uploads/:filename", () => {
  it("serves a stored image with a safe content type", async () => {
    const { url } = (await (await upload("u1", pngBytes())).json()) as {
      url: string;
    };

    const res = await appAs(null).request(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    // A browser must never sniff and execute what it finds here.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("404s an unknown file", async () => {
    expect((await appAs(null).request("/uploads/nope.png")).status).toBe(404);
  });

  it("refuses path traversal", async () => {
    // Files are resolved via the database, not by joining the path — so this
    // can't escape the directory even in principle.
    for (const path of [
      "/uploads/..%2F..%2Fetc%2Fpasswd",
      "/uploads/../../../etc/passwd",
    ]) {
      const res = await appAs(null).request(path);
      expect(res.status).toBe(404);
    }
  });

  it("does not serve a file that isn't a recorded asset", async () => {
    // Even if something lands in the directory, it isn't reachable without a row.
    const res = await appAs(null).request("/uploads/stray.png");
    expect(res.status).toBe(404);
  });
});
