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
import { attacks, plans, users } from "../../src/db/schema.js";
import { createPlan } from "../../src/plans/planRepo.js";
import {
  attackDefsForPlan,
  getAttackDefsByIds,
  listAttacksForEncounter,
  listAttacksForPlan,
  saveAttack,
} from "../../src/attacks/attacksRepo.js";
import { renderPlanSvg } from "../../src/og/renderPlanSvg.js";

const TINT = "#abcdef";

const def = (over: Partial<AttackDef> = {}): AttackDef => ({
  id: "atk1",
  scope: { kind: "encounter", encounterId: "enc1" },
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
  slides: [{ id: "end", name: "End", states: {}, animations: [] }],

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
      slideId: "s0",
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
  groups: {},
  slides: [{ id: "s0", states: {}, animations: [] }],
  schemaVersion: SCHEMA_VERSION,
});

describe("attacksRepo", () => {
  let db: Db;
  let close: () => void;
  beforeEach(() => ({ db, close } = createTestDb()));
  afterEach(() => close());

  /** A real plan row, since `plan_id` is a foreign key that actually cascades. */
  let owners = 0;
  const makePlan = () => {
    const ownerId = `u${++owners}`;
    db.insert(users)
      .values({ id: ownerId, discordId: ownerId, name: "Owner" })
      .run();
    return createPlan(db, {
      ownerId,
      background: { assetId: "arena", width: 100, height: 100 },
    });
  };
  const scopeOf = (planId: string) => ({ kind: "plan" as const, planId });

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
    saveAttack(
      db,
      def({
        id: "c",
        name: "Other",
        scope: { kind: "encounter", encounterId: "enc2" },
      }),
    );
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

  it("keeps an encounter's library and a plan's own apart", () => {
    const plan = makePlan();
    saveAttack(db, def({ id: "lib", name: "Curated" }));
    saveAttack(db, def({ id: "own", name: "Mine", scope: scopeOf(plan.id) }));

    // Neither listing leaks into the other: that separation *is* "confined to
    // their plan" (§19.1), and it is the thing the whole gate rests on.
    expect(listAttacksForEncounter(db, "enc1").map((d) => d.id)).toEqual([
      "lib",
    ]);
    expect(listAttacksForPlan(db, plan.id).map((d) => d.id)).toEqual(["own"]);
  });

  it("shows a plan's attacks to that plan only", () => {
    const mine = makePlan();
    const theirs = makePlan();
    saveAttack(db, def({ id: "own", scope: scopeOf(mine.id) }));
    expect(listAttacksForPlan(db, theirs.id)).toEqual([]);
  });

  // The row is where an authorization decision is made, so a row that claimed
  // both an encounter and a plan would be a row with two answers about who owns
  // it. The union makes that unsayable in the document; this is the copy.
  it("refuses a row that is scoped to both, or to neither", () => {
    const row = {
      id: "bad",
      name: "Bad",
      version: 1,
      doc: "{}",
    };
    expect(() =>
      db
        .insert(attacks)
        .values({ ...row, encounterId: "enc1", planId: makePlan().id })
        .run(),
    ).toThrow();
    expect(() => db.insert(attacks).values(row).run()).toThrow();
  });

  it("takes a plan's own attacks with it when the plan is deleted", () => {
    const plan = makePlan();
    saveAttack(db, def({ id: "own", scope: scopeOf(plan.id) }));
    db.delete(plans).where(eq(plans.id, plan.id)).run();
    // An attack confined to a plan has no meaning once the plan is gone, and
    // nobody could reach it to clean it up: `canEdit` needs a plan to ask about.
    expect(getAttackDefsByIds(db, ["own"])).toEqual({});
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
