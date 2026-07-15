import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client.js";

/**
 * Where the generated SQL migrations live.
 *
 * Resolved relative to *this module* rather than the process CWD, because
 * systemd starts the server from `/srv/raidplans` while tests run from the
 * package root (plan §14). The depth differs between running the sources
 * (`src/db/migrate.ts`, via tsx/vitest) and the tsup bundle
 * (`dist/server.js`), so probe both rather than assume one — getting this
 * wrong means the service boots and then fails on its first query.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  resolve(HERE, "../../drizzle"), // src/db/migrate.ts
  resolve(HERE, "../drizzle"), // dist/server.js (bundled)
];

export const MIGRATIONS_FOLDER =
  CANDIDATES.find((path) => existsSync(path)) ?? CANDIDATES[0]!;

/** Apply any pending migrations. Safe to call on every boot. */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
