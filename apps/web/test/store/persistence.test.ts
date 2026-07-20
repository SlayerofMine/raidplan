import { beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Plan } from "@raidplan/shared";
import {
  clearPlan,
  loadPlan,
  savePlan,
  STORAGE_KEY,
} from "../../src/store/persistence";

/** Minimal in-memory Storage stand-in, so tests never touch a real browser. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

function plan(): Plan {
  return {
    id: "local",
    title: "Saved",
    raid: "",
    background: { assetId: "arena", width: 1600, height: 900 },
    objects: [],
    steps: [],
    schemaVersion: SCHEMA_VERSION,
  };
}

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
});

describe("persistence", () => {
  it("round-trips a plan through storage", () => {
    expect(savePlan(plan(), storage)).toBe(true);
    expect(loadPlan(storage)).toEqual(plan());
  });

  it("returns null when nothing is saved", () => {
    expect(loadPlan(storage)).toBeNull();
  });

  it("returns null (never throws) for corrupt JSON", () => {
    storage.setItem(STORAGE_KEY, "{not json");
    expect(loadPlan(storage)).toBeNull();
  });

  it("returns null for JSON that isn't a valid plan", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: "x", nope: true }));
    expect(loadPlan(storage)).toBeNull();
  });

  it("rejects a plan whose objects violate the schema", () => {
    const bad = plan() as unknown as { objects: unknown[] };
    bad.objects = [{ id: "a", type: "not-a-type", base: {} }];
    storage.setItem(STORAGE_KEY, JSON.stringify(bad));
    expect(loadPlan(storage)).toBeNull();
  });

  it("clearPlan removes the saved plan", () => {
    savePlan(plan(), storage);
    clearPlan(storage);
    expect(loadPlan(storage)).toBeNull();
  });

  it("savePlan reports failure when storage throws (quota/private mode)", () => {
    const hostile: Storage = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(savePlan(plan(), hostile)).toBe(false);
  });
});
