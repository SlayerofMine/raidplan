import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DEFAULT_ENCOUNTERS } from "@raidplan/shared";
import { createTestDb } from "../../src/db/testDb.js";
import type { Db } from "../../src/db/client.js";
import { encounters } from "../../src/db/schema.js";
import {
  getEncounter,
  listEncounters,
  seedDefaultEncounters,
  upsertEncounter,
} from "../../src/encounters/encountersRepo.js";

const background = { assetId: "arena", width: 1600, height: 900 };

describe("encountersRepo", () => {
  let db: Db;
  let close: () => void;

  beforeEach(() => {
    ({ db, close } = createTestDb());
  });
  afterEach(() => close());

  it("seeds the starter encounters", () => {
    seedDefaultEncounters(db);
    expect(listEncounters(db)).toHaveLength(DEFAULT_ENCOUNTERS.length);
  });

  it("is idempotent — re-seeding never duplicates", () => {
    seedDefaultEncounters(db);
    seedDefaultEncounters(db);
    expect(listEncounters(db)).toHaveLength(DEFAULT_ENCOUNTERS.length);
  });

  it("never clobbers an edited encounter on re-seed", () => {
    seedDefaultEncounters(db);
    const seeded = listEncounters(db)[0]!;
    upsertEncounter(db, {
      slug: seeded.slug,
      raid: "My Raid",
      name: "Renamed by admin",
      preset: { background, objects: [], steps: [] },
    });

    seedDefaultEncounters(db); // a later boot

    const after = getEncounter(db, seeded.id);
    expect(after?.name).toBe("Renamed by admin");
    expect(after?.raid).toBe("My Raid");
  });

  it("upserts by slug: a second save with the same slug updates in place", () => {
    const first = upsertEncounter(db, {
      slug: "raid-boss",
      raid: "Raid",
      name: "Boss",
      preset: { background, objects: [], steps: [] },
    });
    const second = upsertEncounter(db, {
      slug: "raid-boss",
      raid: "Raid",
      name: "Boss (v2)",
      preset: { background, objects: [], steps: [] },
    });

    expect(second.id).toBe(first.id);
    expect(listEncounters(db)).toHaveLength(1);
    expect(getEncounter(db, first.id)?.name).toBe("Boss (v2)");
  });

  it("returns the full preset for one encounter, and undefined for a stranger", () => {
    const rec = upsertEncounter(db, {
      slug: "with-object",
      raid: "Raid",
      name: "Has a token",
      preset: {
        background,
        objects: [
          {
            id: "boss",
            type: "token",
            base: {
              x: 1,
              y: 2,
              w: 64,
              h: 64,
              rotation: 0,
              opacity: 1,
              z: 0,
              visible: true,
            },
          },
        ],
        steps: [],
      },
    });

    expect(getEncounter(db, rec.id)?.preset.objects).toHaveLength(1);
    expect(getEncounter(db, "nope")).toBeUndefined();
  });

  it("lists summaries ordered by raid then name, with the background", () => {
    upsertEncounter(db, {
      slug: "b",
      raid: "Zephyr",
      name: "Alpha",
      preset: { background, objects: [], steps: [] },
    });
    upsertEncounter(db, {
      slug: "a",
      raid: "Amirdrassil",
      name: "Beta",
      preset: { background, objects: [], steps: [] },
    });

    const list = listEncounters(db);
    expect(list.map((e) => e.raid)).toEqual(["Amirdrassil", "Zephyr"]);
    expect(list[0]!.background).toEqual(background);
  });

  it("skips a row whose stored doc is corrupt rather than throwing", () => {
    const rec = upsertEncounter(db, {
      slug: "ok",
      raid: "Raid",
      name: "Fine",
      preset: { background, objects: [], steps: [] },
    });
    // Simulate a row written by an older/broken build.
    db.update(encounters)
      .set({ doc: '{"background":null}' })
      .where(eq(encounters.id, rec.id))
      .run();
    expect(listEncounters(db)).toEqual([]);
    expect(getEncounter(db, rec.id)).toBeUndefined();
  });
});
