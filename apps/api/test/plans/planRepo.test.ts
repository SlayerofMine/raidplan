import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SCHEMA_VERSION, type Plan } from "@raidplan/shared";
import type { Db } from "../../src/db/client.js";
import { planData, plans, users } from "../../src/db/schema.js";
import { createTestDb } from "../../src/db/testDb.js";
import {
  createPlan,
  duplicatePlan,
  getPlanWithDoc,
  listPlansFor,
  PlanConflictError,
  renamePlan,
  saveDoc,
  setVisibility,
  softDeletePlan,
} from "../../src/plans/planRepo.js";

const BACKGROUND = { assetId: "arena", width: 1600, height: 900 };
let db: Db;
let close: () => void;

function addUser(id: string) {
  db.insert(users)
    .values({ id, discordId: `d_${id}`, name: id })
    .run();
}

beforeEach(() => {
  ({ db, close } = createTestDb());
  addUser("u1");
  addUser("u2");
});

afterEach(() => close());

describe("createPlan", () => {
  it("creates a private plan with a document and an unguessable slug", () => {
    const plan = createPlan(db, { ownerId: "u1", background: BACKGROUND });

    expect(plan.visibility).toBe("private");
    expect(plan.version).toBe(1);
    expect(plan.slug).toMatch(/^[a-z2-9]{10}$/);
    expect(plan.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(plan.doc.objects).toEqual([]);
    // The document's id matches the row it belongs to.
    expect(plan.doc.id).toBe(plan.id);
  });

  it("gives every plan a distinct slug", () => {
    const slugs = new Set(
      Array.from(
        { length: 25 },
        () => createPlan(db, { ownerId: "u1", background: BACKGROUND }).slug,
      ),
    );
    expect(slugs.size).toBe(25);
  });

  it("refuses to create a plan for a user who doesn't exist", () => {
    // Foreign keys are only enforced if the pragma is on — this is the guard.
    expect(() =>
      createPlan(db, { ownerId: "ghost", background: BACKGROUND }),
    ).toThrow();
  });
});

describe("getPlanWithDoc", () => {
  it("round-trips the document through SQLite", () => {
    const created = createPlan(db, {
      ownerId: "u1",
      title: "Mythic",
      background: BACKGROUND,
    });
    const loaded = getPlanWithDoc(db, created.id);
    expect(loaded?.doc).toEqual(created.doc);
    expect(loaded?.title).toBe("Mythic");
  });

  it("returns undefined for an unknown id", () => {
    expect(getPlanWithDoc(db, "nope")).toBeUndefined();
  });

  it("returns undefined rather than throwing on a corrupt stored document", () => {
    const created = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    db.update(planData)
      .set({ doc: '{"not":"a plan"}' })
      .where(eq(planData.planId, created.id))
      .run();
    // A row written by an older/broken build must not crash a reader.
    expect(getPlanWithDoc(db, created.id)).toBeUndefined();
  });
});

describe("saveDoc", () => {
  it("replaces the document and bumps the version", () => {
    const created = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    const doc: Plan = { ...created.doc, title: "Renamed via doc" };

    const { version } = saveDoc(db, { planId: created.id, doc });
    expect(version).toBe(2);

    const loaded = getPlanWithDoc(db, created.id);
    expect(loaded?.doc.title).toBe("Renamed via doc");
    expect(loaded?.version).toBe(2);
  });

  it("mirrors title/raid onto the row so listings never read the blob", () => {
    const created = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    saveDoc(db, {
      planId: created.id,
      doc: { ...created.doc, title: "P2", raid: "aberrus" },
    });

    const row = db.select().from(plans).where(eq(plans.id, created.id)).get();
    expect(row).toMatchObject({ title: "P2", raid: "aberrus" });
  });

  it("accepts a save that carries the version it loaded", () => {
    const created = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    expect(
      saveDoc(db, {
        planId: created.id,
        doc: created.doc,
        expectedVersion: 1,
      }).version,
    ).toBe(2);
  });

  it("rejects a stale save instead of clobbering newer work", () => {
    const created = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    // Another tab saves first…
    saveDoc(db, { planId: created.id, doc: created.doc, expectedVersion: 1 });

    // …so this one, still holding version 1, must be refused (plan §15).
    expect(() =>
      saveDoc(db, {
        planId: created.id,
        doc: { ...created.doc, title: "stale" },
        expectedVersion: 1,
      }),
    ).toThrow(PlanConflictError);

    expect(getPlanWithDoc(db, created.id)?.doc.title).not.toBe("stale");
  });

  it("reports the current version on conflict so the client can recover", () => {
    const created = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    saveDoc(db, { planId: created.id, doc: created.doc });
    try {
      saveDoc(db, {
        planId: created.id,
        doc: created.doc,
        expectedVersion: 1,
      });
      expect.unreachable("should have conflicted");
    } catch (error) {
      expect(error).toBeInstanceOf(PlanConflictError);
      expect((error as PlanConflictError).currentVersion).toBe(2);
    }
  });

  it("forces the write when no version is supplied", () => {
    const created = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    saveDoc(db, { planId: created.id, doc: created.doc });
    expect(saveDoc(db, { planId: created.id, doc: created.doc }).version).toBe(
      3,
    );
  });

  it("throws for a plan that doesn't exist", () => {
    const created = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    expect(() => saveDoc(db, { planId: "ghost", doc: created.doc })).toThrow();
  });
});

describe("renamePlan", () => {
  it("renames the row and the document together", () => {
    const created = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    renamePlan(db, created.id, "New name");

    const loaded = getPlanWithDoc(db, created.id);
    expect(loaded?.title).toBe("New name");
    // The title is stored twice; they must not drift.
    expect(loaded?.doc.title).toBe("New name");
  });
});

describe("listPlansFor", () => {
  it("lists a user's own plans, newest first", () => {
    const a = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    const b = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    // Make b unambiguously newer.
    db.update(plans)
      .set({ updatedAt: 9_999_999_999 })
      .where(eq(plans.id, b.id))
      .run();

    const list = listPlansFor(db, { userId: "u1", guildIds: [] });
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it("does not list other people's plans", () => {
    createPlan(db, { ownerId: "u2", background: BACKGROUND });
    expect(listPlansFor(db, { userId: "u1", guildIds: [] })).toEqual([]);
  });

  it("omits soft-deleted plans", () => {
    const plan = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    softDeletePlan(db, plan.id);
    expect(listPlansFor(db, { userId: "u1", guildIds: [] })).toEqual([]);
  });
});

describe("setVisibility / softDeletePlan", () => {
  it("changes visibility", () => {
    const plan = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    setVisibility(db, plan.id, "unlisted");
    expect(getPlanWithDoc(db, plan.id)?.visibility).toBe("unlisted");
  });

  it("soft delete keeps the row for recovery", () => {
    const plan = createPlan(db, { ownerId: "u1", background: BACKGROUND });
    softDeletePlan(db, plan.id);
    const row = db.select().from(plans).where(eq(plans.id, plan.id)).get();
    expect(row?.deletedAt).toBeTypeOf("number");
  });
});

describe("duplicatePlan", () => {
  it("copies the content under a new identity", () => {
    const source = createPlan(db, {
      ownerId: "u1",
      title: "Original",
      background: BACKGROUND,
    });
    saveDoc(db, {
      planId: source.id,
      doc: {
        ...source.doc,
        objects: [
          {
            id: "o1",
            type: "token",
            iconId: "marker-1",
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
      },
    });

    const copy = duplicatePlan(db, { planId: source.id, ownerId: "u2" });

    expect(copy?.id).not.toBe(source.id);
    expect(copy?.slug).not.toBe(source.slug);
    expect(copy?.ownerId).toBe("u2");
    expect(copy?.title).toBe("Original copy");
    expect(copy?.doc.objects).toHaveLength(1);
    // The document must belong to the copy, not still claim the original's id.
    expect(copy?.doc.id).toBe(copy?.id);

    // …and the original is untouched.
    expect(getPlanWithDoc(db, source.id)?.title).toBe("Original");
  });

  it("returns undefined for an unknown plan", () => {
    expect(
      duplicatePlan(db, { planId: "ghost", ownerId: "u1" }),
    ).toBeUndefined();
  });
});
