import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * The persistence schema (plan §5 "Persistence schema").
 *
 * The whole Plan lives as one JSON blob in `plan_data.doc`; the relational
 * columns on `plans` exist only for listing, access control and search. That's
 * what keeps loading/saving a plan a single atomic read/write of a few tens of
 * KB (plan §5).
 *
 * Timestamps are unix epoch seconds (integers) — SQLite has no date type, and
 * integers sort and compare without any driver-level coercion.
 */
const now = sql`(unixepoch())`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at").notNull().default(now),
});

export const guilds = sqliteTable("guilds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  discordGuildId: text("discord_guild_id").notNull().unique(),
  createdAt: integer("created_at").notNull().default(now),
});

/** Role within a guild. Ordered by power — see `roleAtLeast` in access.ts. */
export const ROLES = ["viewer", "editor", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const memberships = sqliteTable(
  "memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull().default("viewer"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.guildId] }),
  }),
);

export const VISIBILITIES = ["private", "unlisted", "public"] as const;

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    /** Short share slug used by `/p/:slug`. */
    slug: text("slug").notNull().unique(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: text("guild_id").references(() => guilds.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    raid: text("raid").notNull().default(""),
    visibility: text("visibility", { enum: VISIBILITIES })
      .notNull()
      .default("private"),
    thumbnailUrl: text("thumbnail_url"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
    /** Soft delete: non-null means deleted (plan §9 `plan.softDelete`). */
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    ownerIdx: index("plans_owner_idx").on(t.ownerId),
    guildIdx: index("plans_guild_idx").on(t.guildId),
  }),
);

/** The current document. One row per plan, replaced wholesale on save. */
export const planData = sqliteTable("plan_data", {
  planId: text("plan_id")
    .primaryKey()
    .references(() => plans.id, { onDelete: "cascade" }),
  schemaVersion: integer("schema_version").notNull(),
  /** The whole Plan as JSON text (plan §5). */
  doc: text("doc").notNull(),
  /**
   * Bumped on every save. The editor sends the version it loaded, so a stale
   * autosave can be rejected rather than silently clobbering newer work
   * (plan §15 "Data loss on autosave races").
   */
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at").notNull().default(now),
});

/** Optional history (plan §5 / Phase 6). Written on save, never read yet. */
export const planVersions = sqliteTable(
  "plan_versions",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    doc: text("doc").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => ({
    planIdx: index("plan_versions_plan_idx").on(t.planId),
  }),
);

export const ASSET_KINDS = ["background", "icon", "upload"] as const;

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ASSET_KINDS }).notNull(),
  url: text("url").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

/**
 * The synced WoW icon catalog (plan §11.1). One row per icon that exists in the
 * game, populated and kept current by the Icon Sync Service.
 *
 * `category` is stored as plain text, not a typed enum: the categoriser
 * (`categorizeIconName`) may gain buckets over time, and a new bucket should
 * never require a schema migration — the closed set lives in the shared
 * contract and is enforced when rows are written, not by the column.
 */
export const ICON_SOURCES = ["bnet", "tact", "pack", "wowhead"] as const;
export type IconSourceName = (typeof ICON_SOURCES)[number];

export const icons = sqliteTable(
  "icons",
  {
    /** Stable slug = the WoW icon name, e.g. `spell_fire_fireball02`. */
    id: text("id").primaryKey(),
    /** WoW FileDataID; null for name-only sources (Wowhead, a pack). */
    fileDataId: integer("file_data_id"),
    displayName: text("display_name").notNull(),
    category: text("category").notNull(),
    /** JSON array of free-text search terms derived from the name. */
    tags: text("tags").notNull().default("[]"),
    /** Our storage URLs (content-hashed → immutable, cacheable forever). */
    url56: text("url_56").notNull(),
    url112: text("url_112").notNull(),
    /** Hash of the source image bytes; drives the incremental "changed?" diff. */
    contentHash: text("content_hash").notNull(),
    source: text("source", { enum: ICON_SOURCES }).notNull(),
    firstSeenBuild: text("first_seen_build"),
    /**
     * Removed-from-game icons are retained and flagged, never deleted, so a
     * historical plan that references one never renders a broken image (§11.1
     * "stability contract").
     */
    deprecated: integer("deprecated").notNull().default(0),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    categoryIdx: index("icons_category_idx").on(t.category),
    // Live icons are the common query; keep them cheap to filter.
    deprecatedIdx: index("icons_deprecated_idx").on(t.deprecated),
  }),
);

/**
 * Admin-authored encounter presets (plan §17, stage 1).
 *
 * Like `plan_data`, the preset body (background + pre-placed objects + steps)
 * lives as one JSON blob in `doc`; the relational columns exist only for the
 * selector — grouping by `raid`, labelling by `name`, and an idempotent seed
 * keyed on `slug`. Rows are few, so parsing `doc` for a background preview is
 * cheap.
 */
export const encounters = sqliteTable(
  "encounters",
  {
    id: text("id").primaryKey(),
    /** Stable identity for the idempotent seed and admin CRUD. */
    slug: text("slug").notNull().unique(),
    raid: text("raid").notNull().default(""),
    name: text("name").notNull(),
    /** The `EncounterPreset` as JSON (plan §17). */
    doc: text("doc").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    raidIdx: index("encounters_raid_idx").on(t.raid),
  }),
);

/**
 * Reusable attack definitions (plan §17, stage 3). Like encounters, the whole
 * `AttackDef` (objects + animations + placement) lives as JSON in `doc`; the
 * columns exist only for listing an encounter's attacks and resolving them by
 * id. `encounter_id` is a plain column, not a foreign key — a dangling attack is
 * harmless (it simply isn't listed) and this keeps seeding and edits order-free.
 */
export const attacks = sqliteTable(
  "attacks",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    /** The `AttackDef` as JSON (plan §17). */
    doc: text("doc").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    encounterIdx: index("attacks_encounter_idx").on(t.encounterId),
  }),
);

/** Status of a sync run. */
export const ICON_SYNC_STATUSES = ["running", "ok", "error"] as const;

/** One audit record per sync attempt (plan §11.1 `icon_sync_runs`). */
export const iconSyncRuns = sqliteTable("icon_sync_runs", {
  id: text("id").primaryKey(),
  startedAt: integer("started_at").notNull().default(now),
  finishedAt: integer("finished_at"),
  /** WoW build the run targeted; null if detection failed before diffing. */
  build: text("build"),
  added: integer("added").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  removed: integer("removed").notNull().default(0),
  status: text("status", { enum: ICON_SYNC_STATUSES })
    .notNull()
    .default("running"),
  error: text("error"),
});
