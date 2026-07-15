import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import * as domainSchema from "./schema.js";
import * as authSchema from "./authSchema.js";

/** Domain tables plus better-auth's own (see `authSchema.ts` for why both). */
const schema = { ...domainSchema, ...authSchema };

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Open a SQLite database with the pragmas the plan calls for (§14 "SQLite
 * tuning"):
 *
 *  - **WAL** so readers never block the single writer.
 *  - **busy_timeout** so a concurrent write waits briefly instead of failing
 *    outright with SQLITE_BUSY.
 *  - **foreign_keys** — SQLite leaves these OFF per-connection by default, so
 *    every `references()` in the schema would be decorative without this.
 */
export function openDb(path: string): { db: Db; close: () => void } {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  // Durable enough for a WAL setup, and far cheaper than FULL.
  sqlite.pragma("synchronous = NORMAL");

  return {
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}
