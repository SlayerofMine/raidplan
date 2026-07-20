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
        steps: [],
      },
    });

    const plan = await callerFor(user).plan.create({
      encounterId: encounter.id,
    });

    expect(plan.raid).toBe("Amirdrassil");
    expect(plan.doc.background).toEqual(BACKGROUND);
    expect(plan.doc.objects).toHaveLength(1);
    expect(plan.doc.objects[0]!.id).toBe("boss");
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
