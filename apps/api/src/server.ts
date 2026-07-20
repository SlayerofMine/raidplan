import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { seedDefaultEncounters } from "./encounters/encountersRepo.js";
import { logger } from "./logger.js";

/**
 * Process entry point: load config, open and migrate the database, then bind.
 * Kept separate from the app definition so importing the app for tests never
 * opens a socket or touches the disk (SRP).
 *
 * Listens on localhost:4000 by default — Caddy reverse-proxies to it
 * (deploy/caddy/Caddyfile).
 */
const config = loadConfig();

if (config.DATABASE_PATH !== ":memory:") {
  mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
}
const { db } = openDb(config.DATABASE_PATH);
// Migrate on boot so a deploy is "build & restart" with no step to forget.
runMigrations(db);
// Insert-if-absent, so the new-plan flow always has starter encounters without
// clobbering anything the admin has authored (plan §17).
seedDefaultEncounters(db);

const app = createApp({ db, config });

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info(
    { port: info.port, authEnabled: config.authEnabled },
    "raidplans-api listening",
  );
});

/**
 * Say what's wrong instead of emitting twenty lines of Node internals.
 *
 * A port clash is the single most common way this fails to start — an earlier
 * `pnpm dev` that didn't shut down, usually. It matters more than it looks:
 * `pnpm dev` runs the API and the web app in parallel, so the web server still
 * comes up, the failure scrolls past, and the app then answers every API call
 * with an empty 500 from the Vite proxy. Naming the cause here saves debugging
 * the symptom over there.
 */
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `\n  Port ${config.PORT} is already in use — RaidPlans' API can't start.\n\n` +
        `  Usually a previous dev server that didn't exit. Free it with:\n` +
        `    pkill -f "tsx watch"\n\n` +
        `  Or run on another port:  PORT=4001 pnpm dev\n` +
        `  (then set WEB_ORIGIN/Vite's proxy target to match)\n`,
    );
    process.exit(1);
  }
  if (error.code === "EACCES") {
    console.error(
      `\n  Not allowed to bind port ${config.PORT}. Ports below 1024 need root;\n` +
        `  in production Caddy fronts this service on 80/443 instead (§14).\n`,
    );
    process.exit(1);
  }
  throw error;
});
