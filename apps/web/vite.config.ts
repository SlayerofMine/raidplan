import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `vitest/config` re-exports Vite's `defineConfig` with the `test` field typed,
// so the build and unit-test configuration live in one file.
export default defineConfig({
  plugins: [react()],
  server: {
    /**
     * Forward API calls to the Node service in development.
     *
     * In production Caddy serves the SPA and proxies these paths to the API
     * from one origin (deploy/caddy/Caddyfile); this makes dev behave the same
     * way, so the browser only ever talks to :5173 — no CORS, and the session
     * cookie is simply same-origin.
     *
     * `/p/*` is proxied too: it's the public *share link*, server-rendered
     * with Open Graph meta for Discord (plan §4.7). The app's own viewer lives
     * at /view/:slug, which stays client-side.
     */
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: false },
      "/trpc": { target: "http://localhost:4000", changeOrigin: false },
      // Anchored regex, not a prefix: a plain "/p" key also matches
      // "/plan/:id/edit" — every editor URL starts with /p — and would send the
      // whole editor to the API.
      "^/p/": { target: "http://localhost:4000", changeOrigin: false },
      // Uploaded maps are served by the API. Without this the SPA fallback
      // answers with index.html, and the browser fails to decode HTML as an
      // image — the upload looks broken even though the file is fine.
      "^/uploads/": { target: "http://localhost:4000", changeOrigin: false },
    },
  },
  preview: {
    /**
     * Vite's preview server inherits `server.proxy` by default. Undo that.
     *
     * Two reasons. It's more faithful: in production Caddy does the proxying
     * and Vite isn't in the request path at all. And it keeps the E2E suite
     * hermetic — otherwise the tests quietly talk to whatever dev API happens
     * to be listening on :4000, so they'd pass or fail depending on the
     * developer's local state, and could write to a real dev database.
     */
    proxy: {},
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Playwright owns the browser end-to-end suite (see playwright.config.ts).
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
