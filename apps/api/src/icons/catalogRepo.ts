import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, like, or, type SQL } from "drizzle-orm";
import {
  ICON_CATALOG_PAGE_SIZE,
  type IconCatalogEntry,
  type IconCatalogPage,
} from "@raidplan/shared";
import type { Db } from "../db/client.js";
import { type IconSourceName, iconSyncRuns, icons } from "../db/schema.js";
import { categorizeIconName } from "./iconName.js";

/**
 * All persistence for the icon catalog and its sync-run audit log (plan §11.1).
 *
 * The only module that talks to the `icons` / `icon_sync_runs` tables, so the
 * orchestrator, routes and CLI share one definition of how a row is written and
 * how the search feed is paginated. The orchestrator depends on the
 * {@link IconCatalogRepo} *interface*, so tests can hand it a fake and never
 * open a database (though the default is backed by real SQLite).
 */

/** What a fetched icon contributes to the catalog. */
export interface UpsertIcon {
  id: string;
  fileDataId: number | null;
  contentHash: string;
  url56: string;
  url112: string;
  source: IconSourceName;
  firstSeenBuild: string | null;
}

/** The catalog state the diff needs: name → what we already have. */
export type ExistingIcon = { contentHash: string; deprecated: boolean };

export interface SyncRunUpdate {
  build: string | null;
  added: number;
  updated: number;
  removed: number;
  status: "ok" | "error";
}

export interface SyncRunRow {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  build: string | null;
  added: number;
  updated: number;
  removed: number;
  status: string;
  error: string | null;
}

export interface SearchParams {
  query?: string | undefined;
  category?: string | undefined;
  cursor?: string | undefined;
  limit?: number;
}

export interface IconCatalogRepo {
  startRun(): string;
  finishRun(id: string, update: SyncRunUpdate): void;
  failRun(id: string, error: string): void;
  getRun(id: string): SyncRunRow | null;
  /** Build of the most recent successful run, for change detection. */
  lastCompletedBuild(): string | null;
  /** Every catalog row keyed by id — the diff's left-hand side. */
  listExisting(): Map<string, ExistingIcon>;
  upsertIcon(icon: UpsertIcon): void;
  /**
   * Deprecate live icons absent from `present`, and restore any deprecated
   * icon that has reappeared. Returns how many were newly deprecated.
   */
  reconcileDeprecation(present: ReadonlySet<string>): number;
  /** The palette's paginated, live-only search feed. */
  search(params: SearchParams): IconCatalogPage;
  /**
   * Resolve specific icons by id — for turning the stable ids a plan stores
   * into current URLs. **Deprecated icons are included**: a plan that
   * references a removed icon must still render (stability contract).
   */
  getByIds(ids: readonly string[]): IconCatalogEntry[];
}

export function createIconCatalogRepo(db: Db): IconCatalogRepo {
  return {
    startRun() {
      const id = randomUUID();
      db.insert(iconSyncRuns).values({ id, status: "running" }).run();
      return id;
    },

    finishRun(id, update) {
      db.update(iconSyncRuns)
        .set({ ...update, finishedAt: Math.floor(Date.now() / 1000) })
        .where(eq(iconSyncRuns.id, id))
        .run();
    },

    failRun(id, error) {
      db.update(iconSyncRuns)
        .set({
          status: "error",
          error: error.slice(0, 1000),
          finishedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(iconSyncRuns.id, id))
        .run();
    },

    getRun(id) {
      return (
        (db.select().from(iconSyncRuns).where(eq(iconSyncRuns.id, id)).get() as
          SyncRunRow | undefined) ?? null
      );
    },

    lastCompletedBuild() {
      const row = db
        .select({ build: iconSyncRuns.build })
        .from(iconSyncRuns)
        .where(eq(iconSyncRuns.status, "ok"))
        .orderBy(desc(iconSyncRuns.startedAt))
        .limit(1)
        .get();
      return row?.build ?? null;
    },

    listExisting() {
      const rows = db
        .select({
          id: icons.id,
          contentHash: icons.contentHash,
          deprecated: icons.deprecated,
        })
        .from(icons)
        .all();
      return new Map(
        rows.map((r) => [
          r.id,
          { contentHash: r.contentHash, deprecated: r.deprecated === 1 },
        ]),
      );
    },

    upsertIcon(icon) {
      const { category, tags, displayName } = categorizeIconName(icon.id);
      const values = {
        id: icon.id,
        fileDataId: icon.fileDataId,
        displayName,
        category,
        tags: JSON.stringify(tags),
        url56: icon.url56,
        url112: icon.url112,
        contentHash: icon.contentHash,
        source: icon.source,
        firstSeenBuild: icon.firstSeenBuild,
        deprecated: 0,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      db.insert(icons)
        .values(values)
        .onConflictDoUpdate({
          target: icons.id,
          // firstSeenBuild is intentionally not overwritten — it records when
          // the icon first appeared, not when it last changed.
          set: {
            fileDataId: values.fileDataId,
            displayName: values.displayName,
            category: values.category,
            tags: values.tags,
            url56: values.url56,
            url112: values.url112,
            contentHash: values.contentHash,
            source: values.source,
            deprecated: 0,
            updatedAt: values.updatedAt,
          },
        })
        .run();
    },

    reconcileDeprecation(present) {
      const rows = db
        .select({ id: icons.id, deprecated: icons.deprecated })
        .from(icons)
        .all();
      let removed = 0;
      const now = Math.floor(Date.now() / 1000);
      for (const row of rows) {
        const isPresent = present.has(row.id);
        if (row.deprecated === 0 && !isPresent) {
          db.update(icons)
            .set({ deprecated: 1, updatedAt: now })
            .where(eq(icons.id, row.id))
            .run();
          removed++;
        } else if (row.deprecated === 1 && isPresent) {
          db.update(icons)
            .set({ deprecated: 0, updatedAt: now })
            .where(eq(icons.id, row.id))
            .run();
        }
      }
      return removed;
    },

    search({ query, category, cursor, limit = ICON_CATALOG_PAGE_SIZE }) {
      const filters: SQL[] = [eq(icons.deprecated, 0)];
      if (category) filters.push(eq(icons.category, category));
      if (cursor) filters.push(gt(icons.id, cursor));
      if (query) {
        const q = `%${query.trim().toLowerCase()}%`;
        // id and tags are lowercase; that covers name/keyword search without a
        // case-folding function on the column.
        const term = or(like(icons.id, q), like(icons.tags, q));
        if (term) filters.push(term);
      }

      // Fetch one extra row to learn whether another page exists.
      const rows = db
        .select({
          id: icons.id,
          displayName: icons.displayName,
          category: icons.category,
          url56: icons.url56,
        })
        .from(icons)
        .where(and(...filters))
        .orderBy(icons.id)
        .limit(limit + 1)
        .all();

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const items: IconCatalogEntry[] = page.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        category: r.category as IconCatalogEntry["category"],
        url: r.url56,
      }));
      return {
        items,
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      };
    },

    getByIds(ids) {
      if (ids.length === 0) return [];
      const rows = db
        .select({
          id: icons.id,
          displayName: icons.displayName,
          category: icons.category,
          url56: icons.url56,
        })
        .from(icons)
        .where(inArray(icons.id, [...ids]))
        .all();
      return rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        category: r.category as IconCatalogEntry["category"],
        url: r.url56,
      }));
    },
  };
}
