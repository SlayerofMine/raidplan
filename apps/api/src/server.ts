import { serve } from "@hono/node-server";
import { app } from "./app.js";

/**
 * Process entry point: bind the Hono app to a port. Kept separate from the app
 * definition so importing the app for tests never opens a socket (SRP).
 *
 * Listens on localhost:4000 by default — Caddy reverse-proxies to it
 * (deploy/caddy/Caddyfile). Override with PORT.
 */
const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`raidplans-api listening on http://localhost:${info.port}`);
});
