import { z } from "zod";

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
  BASE_URL: z.string().url().default("http://localhost:4000"),
  DATABASE_PATH: z.string().min(1).default("./data/app.db"),

  // Auth (plan §10). Optional so the API can boot for local canvas work
  // before Discord credentials exist; `authEnabled` reports whether it's live.
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(16).optional(),
});

export type Config = z.infer<typeof ConfigSchema> & {
  /** True when Discord OAuth is fully configured. */
  authEnabled: boolean;
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

  return { ...config, authEnabled };
}
