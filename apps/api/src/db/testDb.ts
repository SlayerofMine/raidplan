import { openDb, type Db } from "./client.js";
import { runMigrations } from "./migrate.js";

/**
 * A fresh, migrated, in-memory database for tests.
 *
 * Tests run against **real SQLite with the real migrations** rather than a
 * mocked repository: the things most likely to break here — foreign keys,
 * unique slugs, cascade deletes — only exist in the database.
 */
export function createTestDb(): { db: Db; close: () => void } {
  const handle = openDb(":memory:");
  runMigrations(handle.db);
  return handle;
}
