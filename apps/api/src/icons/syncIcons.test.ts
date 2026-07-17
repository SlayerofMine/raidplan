import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client.js";
import { createTestDb } from "../db/testDb.js";
import { createIconCatalogRepo } from "./catalogRepo.js";
import { startSync, type SyncDeps } from "./syncIcons.js";
import { staticBuildDetector } from "./buildDetector.js";
import type {
  IconImageSource,
  IconIndexEntry,
  IconIndexSource,
  ImageConverter,
  IconStore,
} from "./types.js";

/** An index that returns whatever names it is given. */
function fakeIndex(names: string[]): IconIndexSource {
  return {
    listIcons: async () =>
      names.map((name, i) => ({ name, fileDataId: i + 1 })),
  };
}

/** An image source that yields bytes derived from the name (or null/throw). */
function fakeImageSource(
  bytesFor: (entry: IconIndexEntry) => Uint8Array | null | "throw",
): IconImageSource {
  return {
    name: "pack",
    fetchImage: async (entry) => {
      const result = bytesFor(entry);
      if (result === "throw") throw new Error("boom");
      return result;
    },
  };
}

/** A converter that tags output with the size, so the two variants differ. */
const fakeConverter: ImageConverter = {
  toWebp: async (bytes, size) => new Uint8Array([size, ...bytes]),
};

/** A store that records what it was asked to persist. */
function fakeStore(): IconStore & { puts: string[] } {
  const puts: string[] = [];
  return {
    puts,
    put: async (hash, size) => {
      const url = `/icons/${hash}_${size}.webp`;
      puts.push(url);
      return url;
    },
  };
}

describe("startSync", () => {
  let db: Db;
  let close: () => void;
  let repo: ReturnType<typeof createIconCatalogRepo>;

  beforeEach(() => {
    ({ db, close } = createTestDb());
    repo = createIconCatalogRepo(db);
  });
  afterEach(() => close());

  function deps(over: Partial<SyncDeps>): SyncDeps {
    return {
      index: fakeIndex(["spell_fire_a", "inv_sword_b"]),
      imageSource: fakeImageSource(() => new Uint8Array([1, 2, 3])),
      converter: fakeConverter,
      store: fakeStore(),
      repo,
      buildDetector: staticBuildDetector("12.1.0.68745"),
      ...over,
    };
  }

  it("returns a runId synchronously, before the job completes", async () => {
    const { runId, done } = startSync(deps({}));
    expect(repo.getRun(runId)?.status).toBe("running");
    await done;
    expect(repo.getRun(runId)?.status).toBe("ok");
  });

  it("adds every new icon: fetch → convert (56+112) → store → upsert", async () => {
    const store = fakeStore();
    const { done } = startSync(deps({ store }));
    const result = await done;

    expect(result.added).toBe(2);
    expect(result.skipped).toBe(false);
    // Two sizes stored per icon.
    expect(store.puts).toHaveLength(4);
    expect(repo.search({}).items.map((i) => i.id)).toEqual([
      "inv_sword_b",
      "spell_fire_a",
    ]);
  });

  it("no-ops when the build is unchanged since the last good run", async () => {
    await startSync(deps({})).done; // first run establishes the build
    const store = fakeStore();
    const result = await startSync(deps({ store })).done;

    expect(result.skipped).toBe(true);
    expect(result.added).toBe(0);
    expect(store.puts).toHaveLength(0); // nothing re-fetched or re-stored
  });

  it("is incremental: a new build only fetches icons new to the catalog", async () => {
    await startSync(deps({})).done; // catalog now has a, b

    const fetchSpy = vi.fn(() => new Uint8Array([9]));
    const result = await startSync(
      deps({
        index: fakeIndex(["spell_fire_a", "inv_sword_b", "spell_frost_c"]),
        imageSource: fakeImageSource(fetchSpy),
        buildDetector: staticBuildDetector("12.2.0.99999"), // new build
      }),
    ).done;

    expect(result.added).toBe(1); // only the new "spell_frost_c"
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("deprecates icons dropped from the index", async () => {
    await startSync(deps({})).done; // a, b

    const result = await startSync(
      deps({
        index: fakeIndex(["spell_fire_a"]), // b removed
        buildDetector: staticBuildDetector("12.2.0.99999"),
      }),
    ).done;

    expect(result.removed).toBe(1);
    expect(repo.search({}).items.map((i) => i.id)).toEqual(["spell_fire_a"]);
  });

  it("skips an icon the source cannot supply without failing the run", async () => {
    const result = await startSync(
      deps({
        imageSource: fakeImageSource((e) =>
          e.name === "inv_sword_b" ? null : new Uint8Array([1]),
        ),
      }),
    ).done;

    expect(result.added).toBe(1); // only the one that had bytes
    expect(repo.getRun(result.runId)?.status).toBe("ok");
  });

  it("skips a per-icon fetch error but still completes the run", async () => {
    const result = await startSync(
      deps({
        imageSource: fakeImageSource((e) =>
          e.name === "inv_sword_b" ? "throw" : new Uint8Array([1]),
        ),
      }),
    ).done;

    expect(result.added).toBe(1);
    expect(repo.getRun(result.runId)?.status).toBe("ok");
  });

  it("marks the run failed and rejects when build detection dies", async () => {
    const buildDetector = {
      currentBuild: async () => {
        throw new Error("wago down");
      },
    };
    const { runId, done } = startSync(deps({ buildDetector }));

    await expect(done).rejects.toThrow(/wago down/);
    const run = repo.getRun(runId);
    expect(run?.status).toBe("error");
    expect(run?.error).toBe("wago down");
  });

  it("force re-fetches existing icons and updates changed bytes", async () => {
    await startSync(deps({})).done; // a, b with bytes [1,2,3]

    let call = 0;
    const result = await startSync(
      deps({
        // Same build, but changed bytes for one icon.
        imageSource: fakeImageSource((e) =>
          e.name === "spell_fire_a"
            ? new Uint8Array([9, 9, ++call])
            : new Uint8Array([1, 2, 3]),
        ),
      }),
      { force: true },
    ).done;

    expect(result.skipped).toBe(false);
    expect(result.updated).toBe(1); // the changed one
    expect(result.added).toBe(0);
  });
});
