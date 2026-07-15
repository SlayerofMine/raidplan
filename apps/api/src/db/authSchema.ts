import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * better-auth's own tables (plan §10).
 *
 * Field names and nullability mirror `getAuthTables()` in `@better-auth/core`
 * exactly — better-auth queries these by name, so a mismatch is a runtime
 * failure at login rather than a compile error. `authSchema.test.ts` asserts
 * this stays in step when better-auth is upgraded.
 *
 * These are deliberately **separate** from our domain `users` table (note the
 * singular names — no collision):
 *
 *  - better-auth owns *authentication* state: sessions, provider accounts, OAuth
 *    tokens. Its shape is its business and changes when we upgrade it.
 *  - `users`/`guilds`/`memberships` own *domain* identity: who owns a plan, who
 *    is in which guild. Nothing there should be hostage to an auth library's
 *    schema.
 *
 * **The two do NOT share a primary key.** better-auth generates its own
 * `user.id`; the id a social provider returns from `getUserInfo` becomes the
 * *account* id. Our domain rows are keyed by the Discord snowflake, which lives
 * on `account.accountId`. `domainUserIdFor()` in `session.ts` is the only place
 * that bridges the two — everything else works in domain ids.
 *
 * SQLite has no date or boolean type, hence the integer modes.
 */
export const authUsers = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * Required and unique by better-auth. RaidPlans never asks Discord for the
   * `email` scope, so this holds a synthetic `…@raidplans.invalid` address
   * (see `auth/discordIdentity.ts`) and `emailVerified` is always false.
   * **Never send mail to it.**
   */
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const authSessions = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
});

export const authAccounts = sqliteTable("account", {
  id: text("id").primaryKey(),
  /** The provider's id for this user — for Discord, the snowflake. */
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const authVerifications = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
