import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Db } from "../../src/db/client.js";
import { users } from "../../src/db/schema.js";
import { createTestDb } from "../../src/db/testDb.js";
import type { Viewer } from "../../src/auth/access.js";
import {
  seedDefaultEncounters,
  upsertEncounter,
} from "../../src/encounters/encountersRepo.js";
import { appRouter } from "../../src/trpc/appRouter.js";
import { createCallerFactory } from "../../src/trpc/context.js";

const BACKGROUND = { assetId: "arena", width: 1600, height: 900 };

let db: Db;
let close: () => void;

const createCaller = createCallerFactory(appRouter);
const callerFor = (viewer: Viewer | null) => createCaller({ db, viewer });
const adminCallerFor = (viewer: Viewer) =>
  createCaller({ db, viewer, isAdmin: true });
const user: Viewer = { userId: "u_user", roles: {} };
const admin: Viewer = { userId: "u_admin", roles: {} };

const BACKGROUND2 = { assetId: "/uploads/map.png", width: 800, height: 600 };

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(TRPCError);
  await promise.catch((e: TRPCError) => expect(e.code).toBe(code));
}

beforeEach(() => {
  ({ db, close } = createTestDb());
  db.insert(users)
    .values({ id: user.userId, discordId: "d_user", name: "User" })
    .run();
});
afterEach(() => close());

describe("encounter.list", () => {
  it("requires a session", async () => {
    await expectCode(callerFor(null).encounter.list(), "UNAUTHORIZED");
  });

  it("returns seeded encounters as summaries", async () => {
    seedDefaultEncounters(db);
    const list = await callerFor(user).encounter.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toMatchObject({
      raid: "Sandbox",
      background: expect.objectContaining({ assetId: expect.any(String) }),
    });
  });
});

describe("plan.create from an encounter", () => {
  it("seeds the plan with the encounter's background, raid and objects", async () => {
    const encounter = upsertEncounter(db, {
      slug: "raid-boss",
      raid: "Amirdrassil",
      name: "Fyrakk",
      preset: {
        background: BACKGROUND,
        attacks: [],
        objects: [
          {
            id: "boss",
            type: "token",
            base: {
              x: 800,
              y: 450,
              w: 64,
              h: 64,
              rotation: 0,
              opacity: 1,
              z: 0,
              visible: true,
            },
          },
        ],
        slides: [],
      },
    });

    const plan = await callerFor(user).plan.create({
      encounterId: encounter.id,
    });

    expect(plan.raid).toBe("Amirdrassil");
    expect(plan.doc.background).toEqual(BACKGROUND);
    expect(plan.doc.objects).toHaveLength(1);
    expect(plan.doc.objects[0]!.id).toBe("boss");
    // Remembered so a plan knows which encounter seeded it (§17).
    expect(plan.doc.encounterId).toBe(encounter.id);
  });

  it("leaves encounterId unset for a bare-map plan", async () => {
    const plan = await callerFor(user).plan.create({ background: BACKGROUND });
    expect(plan.doc.encounterId).toBeUndefined();
  });

  it("404s on an unknown encounter instead of a blank plan", async () => {
    await expectCode(
      callerFor(user).plan.create({ encounterId: "nope" }),
      "NOT_FOUND",
    );
  });

  it("still creates a bare-map plan when given a background", async () => {
    const plan = await callerFor(user).plan.create({ background: BACKGROUND });
    expect(plan.doc.background).toEqual(BACKGROUND);
    expect(plan.doc.objects).toEqual([]);
  });

  it("rejects a create with neither an encounter nor a map", async () => {
    await expectCode(callerFor(user).plan.create({}), "BAD_REQUEST");
  });
});

describe("me.get", () => {
  it("reports admin status so the client can gate the panel", async () => {
    db.insert(users)
      .values({ id: admin.userId, discordId: "d_admin", name: "Admin" })
      .run();
    expect((await adminCallerFor(admin).me.get()).isAdmin).toBe(true);
    expect((await callerFor(user).me.get()).isAdmin).toBe(false);
  });
});

describe("encounter authoring (admin only)", () => {
  const newEncounter = {
    name: "Fyrakk the Blazing",
    raid: "Amirdrassil",
    background: BACKGROUND,
  };

  it("forbids a signed-in non-admin, and rejects the anonymous", async () => {
    await expectCode(
      callerFor(user).encounter.create(newEncounter),
      "FORBIDDEN",
    );
    await expectCode(
      callerFor(null).encounter.create(newEncounter),
      "UNAUTHORIZED",
    );
  });

  it("creates an encounter with a slug derived from the name", async () => {
    const created = await adminCallerFor(admin).encounter.create(newEncounter);
    expect(created.slug).toBe("fyrakk-the-blazing");
    const list = await callerFor(user).encounter.list();
    expect(list.map((e) => e.name)).toContain("Fyrakk the Blazing");
  });

  it("de-duplicates slugs when two encounters share a name", async () => {
    const a = await adminCallerFor(admin).encounter.create(newEncounter);
    const b = await adminCallerFor(admin).encounter.create(newEncounter);
    expect(a.slug).toBe("fyrakk-the-blazing");
    expect(b.slug).toBe("fyrakk-the-blazing-2");
  });

  it("updates fields while preserving pre-placed content", async () => {
    const seeded = upsertEncounter(db, {
      slug: "has-objects",
      raid: "Old",
      name: "Old name",
      preset: {
        background: BACKGROUND,
        attacks: [],
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
        slides: [],
      },
    });

    const updated = await adminCallerFor(admin).encounter.update({
      id: seeded.id,
      name: "New name",
      background: BACKGROUND2,
    });

    expect(updated.name).toBe("New name");
    expect(updated.raid).toBe("Old"); // untouched fields survive
    expect(updated.preset.background).toEqual(BACKGROUND2);
    expect(updated.preset.objects).toHaveLength(1); // not wiped
  });

  it("404s updating or removing an unknown encounter", async () => {
    await expectCode(
      adminCallerFor(admin).encounter.update({ id: "nope", name: "x" }),
      "NOT_FOUND",
    );
    await expectCode(
      adminCallerFor(admin).encounter.remove({ id: "nope" }),
      "NOT_FOUND",
    );
  });

  it("removes an encounter", async () => {
    const created = await adminCallerFor(admin).encounter.create(newEncounter);
    await adminCallerFor(admin).encounter.remove({ id: created.id });
    expect(await callerFor(user).encounter.list()).toEqual([]);
  });
});

describe("shipping attacks with a map (plan §21)", () => {
  const box = {
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    rotation: 0,
    opacity: 1,
    visible: true,
  };
  const attack = (over: Record<string, unknown> = {}) => ({
    id: "def_1",
    name: "Fireball",
    source: "plan" as const,
    objects: [{ id: "puddle", type: "token" as const, base: { ...box, z: 0 } }],
    slide: { id: "s", states: { puddle: box }, animations: [] },
    params: [],
    ...over,
  });

  const seedEncounter = () =>
    upsertEncounter(db, {
      slug: "fyrakk",
      raid: "Amirdrassil",
      name: "Fyrakk",
      preset: { background: BACKGROUND, objects: [], slides: [], attacks: [] },
    });

  it("refuses a signed-in caller who isn't an admin", async () => {
    const encounter = seedEncounter();
    await expectCode(
      callerFor(user).encounter.publishAttack({
        id: encounter.id,
        attack: attack(),
      }),
      "FORBIDDEN",
    );
  });

  it("refuses an anonymous caller before it asks about admin at all", async () => {
    const encounter = seedEncounter();
    await expectCode(
      callerFor(null).encounter.publishAttack({
        id: encounter.id,
        attack: attack(),
      }),
      "UNAUTHORIZED",
    );
  });

  it("marks a published attack as coming from the map, whatever it claimed", async () => {
    const encounter = seedEncounter();
    const updated = await adminCallerFor(admin).encounter.publishAttack({
      id: encounter.id,
      attack: attack({ source: "plan" }),
    });
    expect(updated.preset.attacks).toHaveLength(1);
    expect(updated.preset.attacks[0]!.source).toBe("preset");
  });

  it("replaces a re-published definition in place rather than leaving two", async () => {
    const encounter = seedEncounter();
    const caller = adminCallerFor(admin);
    await caller.encounter.publishAttack({
      id: encounter.id,
      attack: attack(),
    });
    const updated = await caller.encounter.publishAttack({
      id: encounter.id,
      attack: attack({ name: "Fireball II" }),
    });
    expect(updated.preset.attacks).toHaveLength(1);
    expect(updated.preset.attacks[0]!.name).toBe("Fireball II");
  });

  it("seeds every new plan from the map with a copy", async () => {
    const encounter = seedEncounter();
    await adminCallerFor(admin).encounter.publishAttack({
      id: encounter.id,
      attack: attack(),
    });
    const plan = await callerFor(user).plan.create({
      encounterId: encounter.id,
    });
    expect(plan.doc.attacks.map((a) => a.name)).toEqual(["Fireball"]);
    expect(plan.doc.attacks[0]!.source).toBe("preset");
  });

  it("leaves plans that already exist alone — the copy is theirs now", async () => {
    const encounter = seedEncounter();
    const caller = callerFor(user);
    const before = await caller.plan.create({ encounterId: encounter.id });

    await adminCallerFor(admin).encounter.publishAttack({
      id: encounter.id,
      attack: attack(),
    });

    const reloaded = await caller.plan.get({ id: before.id });
    expect(reloaded.doc.attacks).toEqual([]);
  });

  it("takes one back out again", async () => {
    const encounter = seedEncounter();
    const caller = adminCallerFor(admin);
    await caller.encounter.publishAttack({
      id: encounter.id,
      attack: attack(),
    });
    const updated = await caller.encounter.unpublishAttack({
      id: encounter.id,
      attackId: "def_1",
    });
    expect(updated.preset.attacks).toEqual([]);
  });

  it("404s for an encounter that isn't there", async () => {
    await expectCode(
      adminCallerFor(admin).encounter.publishAttack({
        id: "nope",
        attack: attack(),
      }),
      "NOT_FOUND",
    );
  });

  it("keeps the attacks when the panel edits name, raid or background", async () => {
    const encounter = seedEncounter();
    const caller = adminCallerFor(admin);
    await caller.encounter.publishAttack({
      id: encounter.id,
      attack: attack(),
    });
    const updated = await caller.encounter.update({
      id: encounter.id,
      name: "Fyrakk (heroic)",
      background: BACKGROUND2,
    });
    expect(updated.preset.attacks).toHaveLength(1);
  });
});
