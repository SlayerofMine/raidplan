import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../config.js";
import type { Db } from "../db/client.js";
import { createTestDb } from "../db/testDb.js";
import { createIconCatalogRepo, type UpsertIcon } from "./catalogRepo.js";
import { staticBuildDetector } from "./buildDetector.js";
import { createIconRoutes } from "./iconRoutes.js";
import type { SyncDeps } from "./syncIcons.js";

const ADMIN = "admin1";

/** Hono's test Response types `.json()` as unknown; read it as a known shape. */
const readJson = <T>(res: Response): Promise<T> => res.json() as Promise<T>;
type Page = { items: { id: string }[]; nextCursor: string | null };

function seedIcon(db: Db, id: string, over: Partial<UpsertIcon> = {}) {
  createIconCatalogRepo(db).upsertIcon({
    id,
    fileDataId: 1,
    contentHash: "h" + id,
    url56: `/icons/${id}_56.webp`,
    url112: `/icons/${id}_112.webp`,
    source: "pack",
    firstSeenBuild: "12.1.0",
    ...over,
  });
}

/** Sync deps that touch nothing external — an empty index that completes ok. */
function fakeSyncDeps(db: Db): SyncDeps {
  return {
    index: { listIcons: async () => [] },
    imageSource: { name: "pack", fetchImage: async () => null },
    converter: { toWebp: async (b) => b },
    store: { put: async (h, s) => `/icons/${h}_${s}.webp` },
    repo: createIconCatalogRepo(db),
    buildDetector: staticBuildDetector("12.1.0"),
  };
}

describe("createIconRoutes", () => {
  let db: Db;
  let close: () => void;
  let iconDir: string;
  let config: Config;
  let userId: string | null;

  beforeEach(async () => {
    ({ db, close } = createTestDb());
    iconDir = await mkdtemp(join(tmpdir(), "icons-"));
    config = loadConfig({ ICON_ADMIN_USER_IDS: ADMIN, ICON_DIR: iconDir });
    userId = null;
  });
  afterEach(() => close());

  function app() {
    return createIconRoutes({
      db,
      config,
      getUserId: () => userId,
      viewerFor: (_db, id) => ({ userId: id, roles: {} }),
      createSyncDeps: () => fakeSyncDeps(db),
    });
  }

  describe("POST /api/admin/icons/sync", () => {
    it("401s an anonymous caller", async () => {
      const res = await app().request("/api/admin/icons/sync", {
        method: "POST",
      });
      expect(res.status).toBe(401);
    });

    it("403s a signed-in non-admin", async () => {
      userId = "someone";
      const res = await app().request("/api/admin/icons/sync", {
        method: "POST",
      });
      expect(res.status).toBe(403);
    });

    it("202s an admin and returns a runId that then has a status", async () => {
      userId = ADMIN;
      const res = await app().request("/api/admin/icons/sync", {
        method: "POST",
      });
      expect(res.status).toBe(202);
      const { runId } = await readJson<{ runId: string }>(res);
      expect(typeof runId).toBe("string");
      expect(createIconCatalogRepo(db).getRun(runId)).not.toBeNull();
    });

    it("tolerates an empty body (no force, configured source)", async () => {
      userId = ADMIN;
      const res = await app().request("/api/admin/icons/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      });
      expect(res.status).toBe(202);
    });
  });

  describe("GET /api/admin/icons/sync/:runId", () => {
    it("returns a run to an admin", async () => {
      const repo = createIconCatalogRepo(db);
      const runId = repo.startRun();
      repo.finishRun(runId, {
        build: "12.1.0",
        added: 5,
        updated: 0,
        removed: 0,
        status: "ok",
      });
      userId = ADMIN;

      const res = await app().request(`/api/admin/icons/sync/${runId}`);
      expect(res.status).toBe(200);
      expect((await readJson<{ added: number }>(res)).added).toBe(5);
    });

    it("404s an unknown run id", async () => {
      userId = ADMIN;
      const res = await app().request("/api/admin/icons/sync/nope");
      expect(res.status).toBe(404);
    });

    it("403s a non-admin", async () => {
      userId = "someone";
      const res = await app().request("/api/admin/icons/sync/whatever");
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/icons", () => {
    it("401s an anonymous caller (guild-readable)", async () => {
      const res = await app().request("/api/icons");
      expect(res.status).toBe(401);
    });

    it("returns a page for a signed-in user", async () => {
      seedIcon(db, "spell_fire_fireball02");
      seedIcon(db, "inv_sword_04");
      userId = "member";

      const res = await app().request("/api/icons");
      expect(res.status).toBe(200);
      const page = await readJson<Page>(res);
      expect(page.items.map((i) => i.id)).toEqual([
        "inv_sword_04",
        "spell_fire_fireball02",
      ]);
      expect(page.nextCursor).toBeNull();
    });

    it("filters by query and category", async () => {
      seedIcon(db, "spell_fire_fireball02");
      seedIcon(db, "inv_sword_04");
      userId = "member";

      const byQuery = await readJson<Page>(
        await app().request("/api/icons?query=sword"),
      );
      expect(byQuery.items.map((i) => i.id)).toEqual(["inv_sword_04"]);

      const byCat = await readJson<Page>(
        await app().request("/api/icons?category=spell"),
      );
      expect(byCat.items.map((i) => i.id)).toEqual(["spell_fire_fireball02"]);
    });

    it("400s an invalid category", async () => {
      userId = "member";
      const res = await app().request("/api/icons?category=bogus");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/icons/resolve", () => {
    it("resolves ids to entries without requiring auth (public art)", async () => {
      seedIcon(db, "spell_fire_fireball02");
      const res = await app().request(
        "/api/icons/resolve?ids=spell_fire_fireball02,missing",
      );
      expect(res.status).toBe(200);
      const { items } = await readJson<Page>(res);
      expect(items.map((i) => i.id)).toEqual(["spell_fire_fireball02"]);
    });

    it("returns an empty list for no ids", async () => {
      const res = await app().request("/api/icons/resolve");
      expect((await readJson<Page>(res)).items).toEqual([]);
    });
  });

  describe("GET /icons/:filename", () => {
    it("serves a stored webp with an immutable cache header", async () => {
      const name = "0123456789abcdef_56.webp";
      await writeFile(join(iconDir, name), new Uint8Array([0x52, 0x49, 0x46]));

      const res = await app().request(`/icons/${name}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toContain("immutable");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("404s a filename that isn't our hash_size.webp scheme", async () => {
      const res = await app().request("/icons/..%2f..%2fetc%2fpasswd");
      expect(res.status).toBe(404);
    });

    it("404s a well-formed name with no file behind it", async () => {
      const res = await app().request("/icons/aaaaaaaaaaaaaaaa_112.webp");
      expect(res.status).toBe(404);
    });
  });
});
