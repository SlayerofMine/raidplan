import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/client.js";
import { users } from "../../src/db/schema.js";
import { createTestDb } from "../../src/db/testDb.js";
import { ensureDevUser, readDevUserId } from "../../src/auth/devAuth.js";

const withCookie = (cookie: string) =>
  new Request("http://x/", { headers: { cookie } });

describe("readDevUserId", () => {
  it("reads the dev_user cookie among others", () => {
    expect(readDevUserId(withCookie("a=1; dev_user=u42; b=2"))).toBe("u42");
  });

  it("url-decodes the value", () => {
    expect(readDevUserId(withCookie("dev_user=disc%3A123"))).toBe("disc:123");
  });

  it("is null when absent, empty, or there's no cookie header", () => {
    expect(readDevUserId(withCookie("other=1"))).toBeNull();
    expect(readDevUserId(withCookie("dev_user="))).toBeNull();
    expect(readDevUserId(new Request("http://x/"))).toBeNull();
  });
});

describe("ensureDevUser", () => {
  let db: Db;
  let close: () => void;
  beforeEach(() => ({ db, close } = createTestDb()));
  afterEach(() => close());

  it("creates the row once and is idempotent", () => {
    ensureDevUser(db, "u1", "First");
    ensureDevUser(db, "u1", "Ignored second name");
    const rows = db.select().from(users).where(eq(users.id, "u1")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("First");
    expect(rows[0]!.discordId).toBe("dev:u1");
  });
});
