import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

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

const app = createApp({ db, config });

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(
    `raidplans-api listening on http://localhost:${info.port} (auth ${
      config.authEnabled ? "enabled" : "disabled"
    })`,
  );
});
