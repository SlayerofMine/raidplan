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
