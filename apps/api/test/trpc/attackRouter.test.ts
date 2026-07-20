import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { AttackDef } from "@raidplan/shared";
import type { Db } from "../../src/db/client.js";
import { users } from "../../src/db/schema.js";
import { createTestDb } from "../../src/db/testDb.js";
import type { Viewer } from "../../src/auth/access.js";
import { saveAttack } from "../../src/attacks/attacksRepo.js";
import { appRouter } from "../../src/trpc/appRouter.js";
import { createCallerFactory } from "../../src/trpc/context.js";

const createCaller = createCallerFactory(appRouter);
const user: Viewer = { userId: "u", roles: {} };

const def = (over: Partial<AttackDef> = {}): AttackDef => ({
  id: "atk1",
  encounterId: "enc1",
  name: "Cone",
  version: 1,
  box: { w: 100, h: 100 },
  anchor: { x: 0, y: 0 },
  objects: [],
  animations: [],
  ...over,
});

let db: Db;
let close: () => void;
beforeEach(() => {
  ({ db, close } = createTestDb());
  db.insert(users).values({ id: "u", discordId: "d", name: "U" }).run();
});
afterEach(() => close());

describe("attack.byIds", () => {
  it("requires a session", async () => {
    await expect(
      createCaller({ db, viewer: null }).attack.byIds({ ids: ["atk1"] }),
    ).rejects.toThrow(TRPCError);
  });

  it("returns the definitions for the given ids", async () => {
    saveAttack(db, def());
    const defs = await createCaller({ db, viewer: user }).attack.byIds({
      ids: ["atk1", "missing"],
    });
    expect(defs.map((d) => d.id)).toEqual(["atk1"]);
  });
});

describe("attack.listForEncounter", () => {
  it("returns an encounter's attacks", async () => {
    saveAttack(db, def({ id: "a", name: "Alpha" }));
    saveAttack(db, def({ id: "b", name: "Other", encounterId: "enc2" }));
    const list = await createCaller({
      db,
      viewer: user,
    }).attack.listForEncounter({ encounterId: "enc1" });
    expect(list.map((d) => d.name)).toEqual(["Alpha"]);
  });
});
