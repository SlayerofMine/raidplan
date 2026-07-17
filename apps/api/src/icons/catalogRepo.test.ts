import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.js";
import { createTestDb } from "../db/testDb.js";
import { createIconCatalogRepo, type UpsertIcon } from "./catalogRepo.js";

function icon(id: string, over: Partial<UpsertIcon> = {}): UpsertIcon {
  return {
    id,
    fileDataId: 1,
    contentHash: "hash-" + id,
    url56: `/icons/${id}_56.webp`,
    url112: `/icons/${id}_112.webp`,
    source: "pack",
    firstSeenBuild: "12.1.0",
    ...over,
  };
}

describe("createIconCatalogRepo", () => {
  let db: Db;
  let close: () => void;
  let repo: ReturnType<typeof createIconCatalogRepo>;

  beforeEach(() => {
    ({ db, close } = createTestDb());
    repo = createIconCatalogRepo(db);
  });
  afterEach(() => close());

  describe("run lifecycle", () => {
    it("records a run from running → ok and exposes the last good build", () => {
      const id = repo.startRun();
      expect(repo.getRun(id)?.status).toBe("running");
      expect(repo.lastCompletedBuild()).toBeNull();

      repo.finishRun(id, {
        build: "12.1.0.68745",
        added: 3,
        updated: 1,
        removed: 0,
        status: "ok",
      });

      const run = repo.getRun(id);
      expect(run?.status).toBe("ok");
      expect(run?.added).toBe(3);
      expect(run?.finishedAt).not.toBeNull();
      expect(repo.lastCompletedBuild()).toBe("12.1.0.68745");
    });

    it("records a failure without advancing the last good build", () => {
      const ok = repo.startRun();
      repo.finishRun(ok, {
        build: "1.0",
        added: 0,
        updated: 0,
        removed: 0,
        status: "ok",
      });
      const bad = repo.startRun();
      repo.failRun(bad, "listfile unreachable");

      expect(repo.getRun(bad)?.status).toBe("error");
      expect(repo.getRun(bad)?.error).toBe("listfile unreachable");
      // A failed run must not become the baseline for change detection.
      expect(repo.lastCompletedBuild()).toBe("1.0");
    });
  });

  describe("upsert + search", () => {
    it("inserts, derives category/tags, and returns live rows", () => {
      repo.upsertIcon(icon("spell_fire_fireball02"));
      const page = repo.search({});
      expect(page.items).toEqual([
        {
          id: "spell_fire_fireball02",
          displayName: "Fire Fireball 02",
          category: "spell",
          url: "/icons/spell_fire_fireball02_56.webp",
        },
      ]);
    });

    it("updates in place on a second upsert of the same id", () => {
      repo.upsertIcon(icon("inv_sword_04"));
      repo.upsertIcon(icon("inv_sword_04", { url56: "/icons/new_56.webp" }));
      const page = repo.search({});
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.url).toBe("/icons/new_56.webp");
    });

    it("filters by category and free-text query", () => {
      repo.upsertIcon(icon("spell_fire_fireball02"));
      repo.upsertIcon(icon("inv_sword_04"));

      expect(repo.search({ category: "item" }).items.map((i) => i.id)).toEqual([
        "inv_sword_04",
      ]);
      expect(repo.search({ query: "fire" }).items.map((i) => i.id)).toEqual([
        "spell_fire_fireball02",
      ]);
      expect(repo.search({ query: "sword" }).items.map((i) => i.id)).toEqual([
        "inv_sword_04",
      ]);
    });

    it("paginates by id keyset with an opaque cursor", () => {
      for (const id of ["a", "b", "c", "d", "e"]) repo.upsertIcon(icon(id));

      const first = repo.search({ limit: 2 });
      expect(first.items.map((i) => i.id)).toEqual(["a", "b"]);
      expect(first.nextCursor).toBe("b");

      const second = repo.search({ limit: 2, cursor: first.nextCursor! });
      expect(second.items.map((i) => i.id)).toEqual(["c", "d"]);

      const third = repo.search({ limit: 2, cursor: second.nextCursor! });
      expect(third.items.map((i) => i.id)).toEqual(["e"]);
      expect(third.nextCursor).toBeNull(); // last page
    });
  });

  describe("getByIds", () => {
    it("resolves stable ids to entries, including deprecated ones", () => {
      repo.upsertIcon(icon("a"));
      repo.upsertIcon(icon("b"));
      repo.reconcileDeprecation(new Set(["a"])); // b now deprecated

      const resolved = repo.getByIds(["a", "b", "missing"]);
      // Deprecated "b" still resolves so a plan referencing it renders.
      expect(resolved.map((r) => r.id).sort()).toEqual(["a", "b"]);
    });

    it("returns nothing for an empty id list without querying", () => {
      expect(repo.getByIds([])).toEqual([]);
    });
  });

  describe("reconcileDeprecation", () => {
    it("deprecates missing icons, hiding them from search, and restores returners", () => {
      repo.upsertIcon(icon("a"));
      repo.upsertIcon(icon("b"));

      // "b" is gone from the index.
      expect(repo.reconcileDeprecation(new Set(["a"]))).toBe(1);
      expect(repo.search({}).items.map((i) => i.id)).toEqual(["a"]);

      // A deprecated icon is retained, not deleted — a plan referencing "b"
      // is never broken (stability contract).
      expect(repo.listExisting().has("b")).toBe(true);

      // "b" comes back in a later build.
      expect(repo.reconcileDeprecation(new Set(["a", "b"]))).toBe(0);
      expect(repo.search({}).items.map((i) => i.id)).toEqual(["a", "b"]);
    });
  });
});
