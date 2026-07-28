import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { AttackDef, AttackScope, Slide } from "@raidplan/shared";
import type { Db } from "../../src/db/client.js";
import { users } from "../../src/db/schema.js";
import { createTestDb } from "../../src/db/testDb.js";
import type { Viewer } from "../../src/auth/access.js";
import { saveAttack } from "../../src/attacks/attacksRepo.js";
import { createPlan, setVisibility } from "../../src/plans/planRepo.js";
import { appRouter } from "../../src/trpc/appRouter.js";
import { createCallerFactory } from "../../src/trpc/context.js";

const createCaller = createCallerFactory(appRouter);
const user: Viewer = { userId: "u", roles: {} };
const stranger: Viewer = { userId: "s", roles: {} };
const admin: Viewer = { userId: "admin", roles: {} };
const asAdmin = () => createCaller({ db, viewer: admin, isAdmin: true });
const as = (viewer: Viewer | null) => createCaller({ db, viewer });

const encounterScope: AttackScope = { kind: "encounter", encounterId: "enc1" };

const content = {
  name: "Cone",
  defaultSize: { w: 100, h: 100 },
  objects: [],
  slides: [{ id: "end", name: "End", states: {}, animations: [] }] as [Slide],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
};

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(TRPCError);
  await promise.catch((e: TRPCError) => expect(e.code).toBe(code));
}

const def = (over: Partial<AttackDef> = {}): AttackDef => ({
  id: "atk1",
  scope: encounterScope,
  name: "Cone",
  version: 1,
  defaultSize: { w: 100, h: 100 },
  objects: [],
  slides: [{ id: "end", name: "End", states: {}, animations: [] }],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
  ...over,
});

let db: Db;
let close: () => void;

/** `u`'s own private plan — the ACL every plan-scoped case is decided against. */
let planId: string;

beforeEach(() => {
  ({ db, close } = createTestDb());
  for (const id of ["u", "s", "admin"]) {
    db.insert(users).values({ id, discordId: id, name: id }).run();
  }
  planId = createPlan(db, {
    ownerId: "u",
    background: { assetId: "arena", width: 100, height: 100 },
  }).id;
});
afterEach(() => close());

const planScope = (): AttackScope => ({ kind: "plan", planId });

describe("attack.byIds", () => {
  it("serves an encounter's attacks to an anonymous visitor", async () => {
    // A public plan's share link is public, and a definition is drawing rather
    // than a secret. Requiring a session here was why a logged-out visitor saw
    // a shared plan render with its mechanics missing (§19.1).
    saveAttack(db, def());
    const defs = await as(null).attack.byIds({ ids: ["atk1", "missing"] });
    expect(defs.map((d) => d.id)).toEqual(["atk1"]);
  });

  it("drops a plan-scoped attack the caller may not see", async () => {
    saveAttack(db, def({ id: "mine", scope: planScope() }));
    saveAttack(db, def({ id: "lib" }));

    // The ids come from the caller, so this is the one place a stranger could
    // ask for someone else's attack by guessing. What they may not read is
    // dropped, exactly like an id that doesn't exist — never refused, which
    // would confirm it is there.
    const seen = await as(stranger).attack.byIds({ ids: ["mine", "lib"] });
    expect(seen.map((d) => d.id)).toEqual(["lib"]);

    const owner = await as(user).attack.byIds({ ids: ["mine", "lib"] });
    expect(owner.map((d) => d.id).sort()).toEqual(["lib", "mine"]);
  });

  it("serves a public plan's own attacks to anyone", async () => {
    setVisibility(db, planId, "public");
    saveAttack(db, def({ id: "mine", scope: planScope() }));
    const defs = await as(null).attack.byIds({ ids: ["mine"] });
    expect(defs.map((d) => d.id)).toEqual(["mine"]);
  });
});

describe("attack.listForEncounter", () => {
  it("returns an encounter's attacks, and only that encounter's", async () => {
    saveAttack(db, def({ id: "a", name: "Alpha" }));
    saveAttack(
      db,
      def({
        id: "b",
        name: "Other",
        scope: { kind: "encounter", encounterId: "enc2" },
      }),
    );
    // A plan's own attack is not part of any encounter's library.
    saveAttack(db, def({ id: "c", name: "Mine", scope: planScope() }));

    const list = await as(user).attack.listForEncounter({
      encounterId: "enc1",
    });
    expect(list.map((d) => d.name)).toEqual(["Alpha"]);
  });
});

describe("attack.listForPlan", () => {
  it("gives a plan's own attacks to whoever may view the plan", async () => {
    saveAttack(db, def({ id: "mine", name: "Mine", scope: planScope() }));
    saveAttack(db, def({ id: "lib", name: "Curated" }));
    const list = await as(user).attack.listForPlan({ planId });
    expect(list.map((d) => d.id)).toEqual(["mine"]);
  });

  it("404s for a stranger, and for a plan that isn't there", async () => {
    // NOT_FOUND rather than FORBIDDEN: "this exists but isn't yours" leaks that
    // it exists, which is `planAccess`'s rule and not a second one.
    await expectCode(as(stranger).attack.listForPlan({ planId }), "NOT_FOUND");
    await expectCode(
      as(user).attack.listForPlan({ planId: "nope" }),
      "NOT_FOUND",
    );
  });
});

describe("authoring an encounter's library (admins only)", () => {
  it("forbids a signed-in non-admin, and rejects the anonymous", async () => {
    await expectCode(
      as(user).attack.create({ scope: encounterScope, ...content }),
      "FORBIDDEN",
    );
    await expectCode(
      as(null).attack.create({ scope: encounterScope, ...content }),
      "UNAUTHORIZED",
    );
  });

  it("creates an attack at version 1 and reads it back", async () => {
    const created = await asAdmin().attack.create({
      scope: encounterScope,
      ...content,
    });
    expect(created.version).toBe(1);
    const got = await asAdmin().attack.get({ id: created.id });
    expect(got.name).toBe("Cone");
    expect(got.scope).toEqual(encounterScope);
  });

  it("replaces the body and bumps the version on update", async () => {
    const created = await asAdmin().attack.create({
      scope: encounterScope,
      ...content,
    });
    const updated = await asAdmin().attack.update({
      id: created.id,
      ...content,
      name: "Renamed",
    });
    expect(updated.name).toBe("Renamed");
    expect(updated.version).toBe(2);
    // Immutable: saving a body cannot move an attack between libraries (§19.1).
    expect(updated.scope).toEqual(encounterScope);
  });

  it("removes an attack", async () => {
    const created = await asAdmin().attack.create({
      scope: encounterScope,
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

describe("authoring inside your own plan (no admin needed)", () => {
  it("lets a plan's editor create, update and delete one", async () => {
    const created = await as(user).attack.create({
      scope: planScope(),
      ...content,
    });
    expect(created.scope).toEqual({ kind: "plan", planId });

    const updated = await as(user).attack.update({
      id: created.id,
      ...content,
      name: "Renamed",
    });
    expect(updated.name).toBe("Renamed");
    expect(updated.scope).toEqual({ kind: "plan", planId });

    await as(user).attack.remove({ id: created.id });
    await expectCode(as(user).attack.get({ id: created.id }), "NOT_FOUND");
  });

  it("refuses a plan that isn't the caller's, and one that isn't there", async () => {
    await expectCode(
      as(stranger).attack.create({ scope: planScope(), ...content }),
      "NOT_FOUND",
    );
    await expectCode(
      as(user).attack.create({
        scope: { kind: "plan", planId: "nope" },
        ...content,
      }),
      "NOT_FOUND",
    );
  });

  it("will not let a stranger edit or delete someone's attack", async () => {
    saveAttack(db, def({ id: "mine", scope: planScope() }));
    await expectCode(
      as(stranger).attack.update({ id: "mine", ...content }),
      "NOT_FOUND",
    );
    await expectCode(as(stranger).attack.remove({ id: "mine" }), "NOT_FOUND");
  });

  it("will not let a viewer of a public plan edit its attacks", async () => {
    // Readable is not writable: the def is served to anyone, and changed by
    // whoever may edit the plan. A public plan is readable by all and writable
    // by none but its own.
    setVisibility(db, planId, "public");
    saveAttack(db, def({ id: "mine", scope: planScope() }));
    await expect(as(stranger).attack.get({ id: "mine" })).resolves.toBeTruthy();
    await expectCode(
      as(stranger).attack.update({ id: "mine", ...content }),
      "FORBIDDEN",
    );
  });

  it("takes the scope from the stored def, not from the caller", async () => {
    // The attack under attack belongs to `u`'s plan. `stranger` owns a plan of
    // their own, and the update input has no scope field at all — so there is
    // nothing to name that could make this their attack to edit.
    saveAttack(db, def({ id: "mine", scope: planScope() }));
    createPlan(db, {
      ownerId: "s",
      background: { assetId: "arena", width: 100, height: 100 },
    });
    await expectCode(
      as(stranger).attack.update({ id: "mine", ...content }),
      "NOT_FOUND",
    );
  });

  it("does not let an admin's allowlist stand in for plan access", async () => {
    // Being a site admin says nothing about someone else's private plan; the
    // encounter allowlist and the plan ACL are separate questions (§19.1).
    saveAttack(db, def({ id: "mine", scope: planScope() }));
    await expectCode(
      asAdmin().attack.update({ id: "mine", ...content }),
      "NOT_FOUND",
    );
  });
});

describe("promotion (§19.3)", () => {
  it("keeps the id, so instances already placed carry on working", async () => {
    saveAttack(db, def({ id: "mine", name: "Good one", scope: planScope() }));

    const promoted = await asAdmin().attack.promote({
      id: "mine",
      encounterId: "enc1",
    });

    // An UPDATE, not a copy. Copying would leave every instance pointing at the
    // old def and make the promotion invisible to the plan that earned it.
    expect(promoted?.id).toBe("mine");
    expect(promoted?.scope).toEqual(encounterScope);
    expect(
      (await as(user).attack.listForEncounter({ encounterId: "enc1" })).map(
        (d) => d.id,
      ),
    ).toEqual(["mine"]);
    // And it has left the plan's own section.
    expect(await as(user).attack.listForPlan({ planId })).toEqual([]);
  });

  it("is the admin's decision, not the plan owner's", async () => {
    // The whole point of the §19.1 gate: anyone may author, publishing to the
    // shared library is what takes an admin.
    saveAttack(db, def({ id: "mine", scope: planScope() }));
    await expectCode(
      as(user).attack.promote({ id: "mine", encounterId: "enc1" }),
      "FORBIDDEN",
    );
  });

  it("refuses one that is already an encounter's, and one that isn't there", async () => {
    saveAttack(db, def({ id: "lib" }));
    await expectCode(
      asAdmin().attack.promote({ id: "lib", encounterId: "enc1" }),
      "BAD_REQUEST",
    );
    await expectCode(
      asAdmin().attack.promote({ id: "nope", encounterId: "enc1" }),
      "NOT_FOUND",
    );
  });
});
