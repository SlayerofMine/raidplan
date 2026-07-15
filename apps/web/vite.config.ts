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
     * Note `/p/:slug` is deliberately *not* proxied: it's a client-side viewer
     * route today. When the server starts rendering it for Discord unfurls
     * (plan §4.7), that will need revisiting here.
     */
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: false },
      "/trpc": { target: "http://localhost:4000", changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Playwright owns the browser end-to-end suite (see playwright.config.ts).
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
