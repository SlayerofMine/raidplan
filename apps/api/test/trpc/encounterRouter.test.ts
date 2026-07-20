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
const user: Viewer = { userId: "u_user", roles: {} };

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
