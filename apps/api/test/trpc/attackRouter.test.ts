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
const admin: Viewer = { userId: "admin", roles: {} };
const asAdmin = () => createCaller({ db, viewer: admin, isAdmin: true });

const content = {
  name: "Cone",
  defaultSize: { w: 100, h: 100 },
  objects: [],
  animations: [],
};

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(TRPCError);
  await promise.catch((e: TRPCError) => expect(e.code).toBe(code));
}

const def = (over: Partial<AttackDef> = {}): AttackDef => ({
  id: "atk1",
  encounterId: "enc1",
  name: "Cone",
  version: 1,
  defaultSize: { w: 100, h: 100 },
  objects: [],
  overrides: {},
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

describe("attack authoring (admin only)", () => {
  it("forbids a signed-in non-admin, and rejects the anonymous", async () => {
    await expectCode(
      createCaller({ db, viewer: user }).attack.create({
        encounterId: "enc1",
        ...content,
      }),
      "FORBIDDEN",
    );
    await expectCode(
      createCaller({ db, viewer: null }).attack.create({
        encounterId: "enc1",
        ...content,
      }),
      "UNAUTHORIZED",
    );
  });

  it("creates an attack at version 1 and reads it back", async () => {
    const created = await asAdmin().attack.create({
      encounterId: "enc1",
      ...content,
    });
    expect(created.version).toBe(1);
    const got = await asAdmin().attack.get({ id: created.id });
    expect(got.name).toBe("Cone");
    expect(got.encounterId).toBe("enc1");
  });

  it("replaces the body and bumps the version on update", async () => {
    const created = await asAdmin().attack.create({
      encounterId: "enc1",
      ...content,
    });
    const updated = await asAdmin().attack.update({
      id: created.id,
      ...content,
      name: "Renamed",
    });
    expect(updated.name).toBe("Renamed");
    expect(updated.version).toBe(2);
    expect(updated.encounterId).toBe("enc1"); // immutable
  });

  it("removes an attack", async () => {
    const created = await asAdmin().attack.create({
      encounterId: "enc1",
      ...content,
    });
    await asAdmin().attack.remove({ id: created.id });
    await expectCode(asAdmin().attack.get({ id: created.id }), "NOT_FOUND");
  });

  it("404s update/remove/get on an unknown attack", async () => {
    await expectCode(
      asAdmin().attack.update({ id: "nope", ...content }),
      "NOT_FOUND",
    );
    await expectCode(asAdmin().attack.remove({ id: "nope" }), "NOT_FOUND");
    await expectCode(asAdmin().attack.get({ id: "nope" }), "NOT_FOUND");
  });
});
