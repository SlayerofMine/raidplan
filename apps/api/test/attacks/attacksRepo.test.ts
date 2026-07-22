import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  expandPlan,
  SCHEMA_VERSION,
  type AttackDef,
  type Plan,
} from "@raidplan/shared";
import { createTestDb } from "../../src/db/testDb.js";
import type { Db } from "../../src/db/client.js";
import { attacks } from "../../src/db/schema.js";
import {
  attackDefsForPlan,
  getAttackDefsByIds,
  listAttacksForEncounter,
  saveAttack,
} from "../../src/attacks/attacksRepo.js";
import { renderPlanSvg } from "../../src/og/renderPlanSvg.js";

const TINT = "#abcdef";

const def = (over: Partial<AttackDef> = {}): AttackDef => ({
  id: "atk1",
  encounterId: "enc1",
  name: "Frontal cone",
  version: 1,
  defaultSize: { w: 200, h: 200 },
  objects: [
    {
      id: "cone",
      type: "shape",
      shape: "cone",
      base: {
        x: 0,
        y: 0,
        w: 200,
        h: 200,
        rotation: 0,
        opacity: 1,
        z: 0,
        visible: true,
        tint: TINT,
      },
    },
  ],
  overrides: {},
  animations: [],
  lookAts: [],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
  ...over,
});

const planWith = (attackId: string): Plan => ({
  id: "p",
  title: "t",
  raid: "",
  background: { assetId: "arena", width: 1600, height: 900 },
  objects: [],
  attacks: [
    {
      id: "i1",
      attackId,
      stepId: "s0",
      x: 400,
      y: 400,
      w: 200,
      h: 200,
      rotation: 0,
      startMs: 0,
      slots: {},
      args: {},
    },
  ],
  steps: [{ id: "s0", overrides: {}, animations: [] }],
  schemaVersion: SCHEMA_VERSION,
});

describe("attacksRepo", () => {
  let db: Db;
  let close: () => void;
  beforeEach(() => ({ db, close } = createTestDb()));
  afterEach(() => close());

  it("saves and resolves definitions by id", () => {
    saveAttack(db, def());
    const byId = getAttackDefsByIds(db, ["atk1", "missing"]);
    expect(Object.keys(byId)).toEqual(["atk1"]);
    expect(byId.atk1!.name).toBe("Frontal cone");
  });

  it("returns nothing for an empty id list without touching the db", () => {
    expect(getAttackDefsByIds(db, [])).toEqual({});
  });

  it("upserts by id, replacing the stored definition", () => {
    saveAttack(db, def());
    saveAttack(db, def({ name: "Renamed", version: 2 }));
    const byId = getAttackDefsByIds(db, ["atk1"]);
    expect(byId.atk1!.name).toBe("Renamed");
    expect(byId.atk1!.version).toBe(2);
  });

  it("lists an encounter's attacks by name", () => {
    saveAttack(db, def({ id: "b", name: "Beta" }));
    saveAttack(db, def({ id: "a", name: "Alpha" }));
    saveAttack(db, def({ id: "c", name: "Other", encounterId: "enc2" }));
    expect(listAttacksForEncounter(db, "enc1").map((d) => d.name)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("gathers exactly the defs a plan references", () => {
    saveAttack(db, def());
    const defs = attackDefsForPlan(db, planWith("atk1"));
    expect(Object.keys(defs)).toEqual(["atk1"]);
  });

  it("skips a row whose stored doc is corrupt", () => {
    saveAttack(db, def());
    db.update(attacks).set({ doc: "{bad" }).where(eq(attacks.id, "atk1")).run();
    expect(getAttackDefsByIds(db, ["atk1"])).toEqual({});
  });
});

describe("OG rendering expands attacks", () => {
  let db: Db;
  let close: () => void;
  beforeEach(() => ({ db, close } = createTestDb()));
  afterEach(() => close());

  it("draws an attack's objects into the share preview", () => {
    saveAttack(db, def());
    const plan = planWith("atk1");

    // The raw plan has no drawable objects; expansion adds the cone.
    expect(renderPlanSvg(plan, 0)).not.toContain(TINT);
    const expanded = expandPlan(plan, attackDefsForPlan(db, plan));
    expect(renderPlanSvg(expanded, 0)).toContain(TINT);
  });
});
