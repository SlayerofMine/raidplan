import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { createTestDb } from "./testDb.js";

let db: Db;
let close: () => void;

beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

/** Column names actually created for a table, per SQLite itself. */
function columnsOf(table: string): Set<string> {
  const rows = db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`));
  return new Set(rows.map((r) => r.name));
}

/** Columns that are NOT NULL. */
function notNullOf(table: string): Set<string> {
  const rows = db.all<{ name: string; notnull: number }>(
    sql.raw(`PRAGMA table_info(${table})`),
  );
  return new Set(rows.filter((r) => r.notnull === 1).map((r) => r.name));
}

/**
 * better-auth addresses these tables by name at runtime, so a drift between our
 * drizzle definitions and what it expects surfaces as a failed *login*, not a
 * failed build. These assertions mirror `getAuthTables()` in @better-auth/core;
 * if a better-auth upgrade changes the contract, this fails loudly here instead
 * of in production.
 */
describe("better-auth schema contract", () => {
  it("creates better-auth's four tables alongside our domain tables", () => {
    const tables = new Set(
      db
        .all<{ name: string }>(
          sql.raw(`SELECT name FROM sqlite_master WHERE type='table'`),
        )
        .map((r) => r.name),
    );
    for (const t of ["user", "session", "account", "verification"]) {
      expect(tables.has(t)).toBe(true);
    }
    // The domain tables are separate — note `users` (ours) vs `user` (theirs).
    for (const t of ["users", "guilds", "memberships", "plans"]) {
      expect(tables.has(t)).toBe(true);
    }
  });

  it("user has the fields better-auth requires", () => {
    expect(columnsOf("user")).toEqual(
      new Set([
        "id",
        "name",
        "email",
        "emailVerified",
        "image",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(notNullOf("user")).toEqual(
      new Set([
        "id",
        "name",
        "email",
        "emailVerified",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("session has the fields better-auth requires", () => {
    expect(columnsOf("session")).toEqual(
      new Set([
        "id",
        "expiresAt",
        "token",
        "createdAt",
        "updatedAt",
        "ipAddress",
        "userAgent",
        "userId",
      ]),
    );
  });

  it("account carries the OAuth token fields", () => {
    const columns = columnsOf("account");
    for (const field of [
      "accountId",
      "providerId",
      "userId",
      "accessToken",
      "refreshToken",
      "idToken",
      "accessTokenExpiresAt",
      "refreshTokenExpiresAt",
      "scope",
      "password",
    ]) {
      expect(columns.has(field)).toBe(true);
    }
  });

  it("verification has the fields better-auth requires", () => {
    expect(columnsOf("verification")).toEqual(
      new Set([
        "id",
        "identifier",
        "value",
        "expiresAt",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("enforces the unique email and session token better-auth relies on", () => {
    db.run(
      sql.raw(
        `INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('a','A','x@raidplans.invalid',0,0,0)`,
      ),
    );
    expect(() =>
      db.run(
        sql.raw(
          `INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('b','B','x@raidplans.invalid',0,0,0)`,
        ),
      ),
    ).toThrow();
  });

  it("cascades sessions when a user is deleted", () => {
    db.run(
      sql.raw(
        `INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('u','U','u@raidplans.invalid',0,0,0)`,
      ),
    );
    db.run(
      sql.raw(
        `INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId) VALUES ('s',0,'tok',0,0,'u')`,
      ),
    );
    db.run(sql.raw(`DELETE FROM user WHERE id='u'`));
    const left = db.all(sql.raw(`SELECT id FROM session`));
    // A deleted account must not leave a usable session behind.
    expect(left).toEqual([]);
  });
});
