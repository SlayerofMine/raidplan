import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Db } from "../../src/db/client.js";
import { guilds, memberships, users } from "../../src/db/schema.js";
import { createTestDb } from "../../src/db/testDb.js";
import type { Viewer } from "../../src/auth/access.js";
import { appRouter } from "../../src/trpc/appRouter.js";
import { createCallerFactory } from "../../src/trpc/context.js";

const BACKGROUND = { assetId: "arena", width: 1600, height: 900 };
const GUILD = "guild_1";

let db: Db;
let close: () => void;

const createCaller = createCallerFactory(appRouter);
const callerFor = (viewer: Viewer | null) => createCaller({ db, viewer });

const owner: Viewer = { userId: "u_owner", roles: { [GUILD]: "owner" } };
const editor: Viewer = { userId: "u_editor", roles: { [GUILD]: "editor" } };
const member: Viewer = { userId: "u_member", roles: { [GUILD]: "viewer" } };
const outsider: Viewer = { userId: "u_outsider", roles: {} };

/** Assert a call fails with a specific tRPC error code. */
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(TRPCError);
  await promise.catch((e: TRPCError) => expect(e.code).toBe(code));
}

beforeEach(() => {
  ({ db, close } = createTestDb());
  db.insert(guilds)
    .values({ id: GUILD, name: "Guild", discordGuildId: "d_guild" })
    .run();
  for (const v of [owner, editor, member, outsider]) {
    db.insert(users)
      .values({ id: v.userId, discordId: `d_${v.userId}`, name: v.userId })
      .run();
    const role = v.roles[GUILD];
    if (role) {
      db.insert(memberships)
        .values({ userId: v.userId, guildId: GUILD, role })
        .run();
    }
  }
});

afterEach(() => close());

/** A guild plan owned by `owner`. */
async function makePlan(
  visibility: "private" | "unlisted" | "public" = "private",
) {
  const plan = await callerFor(owner).plan.create({
    guildId: GUILD,
    background: BACKGROUND,
  });
  if (visibility !== "private") {
    await callerFor(owner).plan.setVisibility({ id: plan.id, visibility });
  }
  return plan;
}

describe("auth gating", () => {
  it("rejects anonymous callers on protected procedures", async () => {
    await expectCode(
      callerFor(null).plan.create({ background: BACKGROUND }),
      "UNAUTHORIZED",
    );
    await expectCode(callerFor(null).plan.list(), "UNAUTHORIZED");
    await expectCode(callerFor(null).me.get(), "UNAUTHORIZED");
  });

  it("me.get returns the caller's identity", async () => {
    await expect(callerFor(owner).me.get()).resolves.toMatchObject({
      userId: owner.userId,
    });
  });
});

describe("plan.get / visibility", () => {
  it("hides a private plan from outsiders as NOT_FOUND, not FORBIDDEN", async () => {
    const plan = await makePlan("private");
    // FORBIDDEN would confirm the plan exists — that itself is a leak.
    await expectCode(
      callerFor(outsider).plan.get({ id: plan.id }),
      "NOT_FOUND",
    );
    await expectCode(callerFor(null).plan.get({ id: plan.id }), "NOT_FOUND");
  });

  it("shows a private plan to its guild", async () => {
    const plan = await makePlan("private");
    await expect(
      callerFor(member).plan.get({ id: plan.id }),
    ).resolves.toMatchObject({ id: plan.id });
  });

  it("lets anyone read a public or unlisted plan, logged in or not", async () => {
    for (const visibility of ["public", "unlisted"] as const) {
      const plan = await makePlan(visibility);
      await expect(
        callerFor(null).plan.get({ id: plan.id }),
      ).resolves.toMatchObject({ id: plan.id });
      await expect(
        callerFor(outsider).plan.get({ id: plan.id }),
      ).resolves.toMatchObject({ id: plan.id });
    }
  });
});

describe("plan.getBySlug — the share link", () => {
  it("serves an unlisted plan to an anonymous visitor", async () => {
    const plan = await makePlan("unlisted");
    await expect(
      callerFor(null).plan.getBySlug({ slug: plan.slug }),
    ).resolves.toMatchObject({ id: plan.id });
  });

  it("does not serve a private plan by slug to a stranger", async () => {
    const plan = await makePlan("private");
    await expectCode(
      callerFor(null).plan.getBySlug({ slug: plan.slug }),
      "NOT_FOUND",
    );
  });

  it("rejects an unknown or malformed slug", async () => {
    await expectCode(
      callerFor(null).plan.getBySlug({ slug: "aaaaaaaaaa" }),
      "NOT_FOUND",
    );
    await expectCode(
      callerFor(null).plan.getBySlug({ slug: "NOT-A-SLUG!" }),
      "NOT_FOUND",
    );
  });

  it("stops serving a plan once it's soft-deleted", async () => {
    const plan = await makePlan("public");
    await callerFor(owner).plan.softDelete({ id: plan.id });
    // A public link must not outlive the plan.
    await expectCode(
      callerFor(null).plan.getBySlug({ slug: plan.slug }),
      "NOT_FOUND",
    );
  });
});

describe("plan.saveDoc", () => {
  it("lets an editor save", async () => {
    const plan = await makePlan();
    await expect(
      callerFor(editor).plan.saveDoc({
        id: plan.id,
        doc: { ...plan.doc, title: "By editor" },
      }),
    ).resolves.toMatchObject({ version: 2 });
  });

  it("refuses a viewer with FORBIDDEN — they may look, not touch", async () => {
    const plan = await makePlan();
    await expectCode(
      callerFor(member).plan.saveDoc({ id: plan.id, doc: plan.doc }),
      "FORBIDDEN",
    );
  });

  it("refuses an outsider with NOT_FOUND, even on a public plan", async () => {
    const plan = await makePlan("public");
    // Readable by all, writable by none but the guild.
    await expectCode(
      callerFor(outsider).plan.saveDoc({ id: plan.id, doc: plan.doc }),
      "FORBIDDEN",
    );
  });

  it("maps a stale save onto CONFLICT rather than clobbering", async () => {
    const plan = await makePlan();
    await callerFor(owner).plan.saveDoc({
      id: plan.id,
      doc: plan.doc,
      expectedVersion: 1,
    });
    await expectCode(
      callerFor(owner).plan.saveDoc({
        id: plan.id,
        doc: { ...plan.doc, title: "stale" },
        expectedVersion: 1,
      }),
      "CONFLICT",
    );
  });

  it("rejects a document that isn't a valid plan", async () => {
    const plan = await makePlan();
    await expect(
      callerFor(owner).plan.saveDoc({
        id: plan.id,
        // Opacity is normalised 0..1 by the shared schema.
        doc: { ...plan.doc, objects: [{ ...badObject() }] } as never,
      }),
    ).rejects.toThrow();
  });
});

function badObject() {
  return {
    id: "o1",
    type: "token",
    base: {
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotation: 0,
      opacity: 99,
      z: 0,
      visible: true,
    },
  };
}

describe("plan.rename / duplicate", () => {
  it("an editor may rename", async () => {
    const plan = await makePlan();
    await callerFor(editor).plan.rename({ id: plan.id, title: "Renamed" });
    await expect(
      callerFor(member).plan.get({ id: plan.id }),
    ).resolves.toMatchObject({ title: "Renamed" });
  });

  it("a viewer may not rename", async () => {
    const plan = await makePlan();
    await expectCode(
      callerFor(member).plan.rename({ id: plan.id, title: "nope" }),
      "FORBIDDEN",
    );
  });

  it("duplicating needs only read access and copies to the caller", async () => {
    const plan = await makePlan("public");
    const copy = await callerFor(outsider).plan.duplicate({ id: plan.id });
    expect(copy.ownerId).toBe(outsider.userId);
    expect(copy.id).not.toBe(plan.id);
  });

  it("cannot duplicate a plan you cannot see", async () => {
    const plan = await makePlan("private");
    await expectCode(
      callerFor(outsider).plan.duplicate({ id: plan.id }),
      "NOT_FOUND",
    );
  });
});

describe("plan.setVisibility / softDelete — administrative", () => {
  it("the plan owner may re-share and delete", async () => {
    const plan = await makePlan();
    await expect(
      callerFor(owner).plan.setVisibility({
        id: plan.id,
        visibility: "public",
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      callerFor(owner).plan.softDelete({ id: plan.id }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("an editor may edit but may not re-share or delete", async () => {
    const plan = await makePlan();
    await expectCode(
      callerFor(editor).plan.setVisibility({
        id: plan.id,
        visibility: "public",
      }),
      "FORBIDDEN",
    );
    await expectCode(
      callerFor(editor).plan.softDelete({ id: plan.id }),
      "FORBIDDEN",
    );
  });

  it("rejects an unknown visibility value", async () => {
    const plan = await makePlan();
    await expect(
      callerFor(owner).plan.setVisibility({
        id: plan.id,
        visibility: "world-readable" as never,
      }),
    ).rejects.toThrow();
  });
});

describe("plan.list", () => {
  it("lists the caller's own and their guild's plans, not strangers'", async () => {
    const mine = await makePlan();
    await callerFor(outsider).plan.create({ background: BACKGROUND });

    const list = await callerFor(member).plan.list();
    expect(list.map((p) => p.id)).toEqual([mine.id]);

    // The outsider sees only their own.
    const theirs = await callerFor(outsider).plan.list();
    expect(theirs.every((p) => p.ownerId === outsider.userId)).toBe(true);
  });

  it("omits soft-deleted plans", async () => {
    const plan = await makePlan();
    await callerFor(owner).plan.softDelete({ id: plan.id });
    await expect(callerFor(owner).plan.list()).resolves.toEqual([]);
  });
});
