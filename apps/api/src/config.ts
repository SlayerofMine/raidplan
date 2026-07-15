import { z } from "zod";
import { ROLES, type Role } from "./db/schema.js";

/**
 * Environment configuration (plan §14 "Config/secrets": `/etc/raidplans/env`).
 *
 * Parsed once, at boot, through zod — a missing `SESSION_SECRET` should stop
 * the service starting with a clear message, not surface as a mystery 500 on
 * the first login.
 */
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // zod 4 moved string formats to the top level; `z.string().url()` still
  // works but is deprecated.
  BASE_URL: z.url().default("http://localhost:4000"),
  /**
   * Where the SPA is served from. In production Caddy serves the app and
   * proxies /api to this service, so it's the same origin as BASE_URL. In
   * development they differ: Vite on :5173, the API on :4000.
   */
  WEB_ORIGIN: z.url().optional(),
  DATABASE_PATH: z.string().min(1).default("./data/app.db"),
  /** Where uploaded backgrounds are written (plan §4.8 / §14). */
  UPLOAD_DIR: z.string().min(1).default("./data/uploads"),

  // Auth (plan §10). Optional so the API can boot for local canvas work
  // before Discord credentials exist; `authEnabled` reports whether it's live.
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  // 32 is better-auth's own floor for adequate entropy; `openssl rand -base64
  // 32` yields 44 chars. Enforce it here so a weak secret fails at boot rather
  // than as a runtime warning nobody reads.
  SESSION_SECRET: z.string().min(32).optional(),

  // Optional Discord role → RaidPlans role mapping (comma-separated role ids).
  // Unset means every member of the server gets DISCORD_DEFAULT_ROLE.
  DISCORD_OWNER_ROLE_IDS: z.string().default(""),
  DISCORD_EDITOR_ROLE_IDS: z.string().default(""),
  DISCORD_DEFAULT_ROLE: z.enum(ROLES).default("viewer"),
});

/** Split a comma-separated env list, tolerating spaces and empties. */
function idList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** How Discord roles map onto RaidPlans roles (plan §10). */
export interface RoleMapping {
  ownerRoleIds: string[];
  editorRoleIds: string[];
  defaultRole: Role;
}

/** Vite's default dev port — where the SPA lives when not behind Caddy. */
const DEV_WEB_ORIGIN = "http://localhost:5173";

export type Config = z.infer<typeof ConfigSchema> & {
  /** True when Discord OAuth is fully configured. */
  authEnabled: boolean;
  roleMapping: RoleMapping;
  /**
   * Resolved origin of the SPA — where a user is sent after signing in.
   *
   * Defaults to BASE_URL in production (Caddy serves both from one origin) and
   * to Vite's dev server otherwise. Without the dev default, every developer
   * lands on a 404 after login: the API has no `/` to redirect them to.
   */
  webOrigin: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const config = parsed.data;

  const authEnabled = Boolean(
    config.DISCORD_CLIENT_ID &&
    config.DISCORD_CLIENT_SECRET &&
    config.SESSION_SECRET,
  );

  // In production, refuse to run half-configured: an API that silently treats
  // everyone as anonymous is worse than one that won't start.
  if (config.NODE_ENV === "production" && !authEnabled) {
    throw new Error(
      "Production requires DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and SESSION_SECRET (see deploy/env.example).",
    );
  }

  return {
    ...config,
    authEnabled,
    webOrigin:
      config.WEB_ORIGIN ??
      (config.NODE_ENV === "production" ? config.BASE_URL : DEV_WEB_ORIGIN),
    roleMapping: {
      ownerRoleIds: idList(config.DISCORD_OWNER_ROLE_IDS),
      editorRoleIds: idList(config.DISCORD_EDITOR_ROLE_IDS),
      defaultRole: config.DISCORD_DEFAULT_ROLE,
    },
  };
}
