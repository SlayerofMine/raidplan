import { defineConfig, devices } from "@playwright/test";

/**
 * Signed-in end-to-end suite (plan §13). Unlike the default hermetic run, this
 * boots a **throwaway API** — an in-memory database and Discord-free sign-in
 * (`DEV_AUTH`) — and points the preview server at it via `E2E_API`. So the
 * protected flows (create a plan, the admin panel) are exercised without any
 * OAuth, and nothing touches a real database.
 *
 * Run explicitly: `pnpm --filter @raidplan/web test:e2e:auth`
 * (needs `pnpm exec playwright install` once for the browser binaries).
 */
const API_PORT = 4100;
const API_ORIGIN = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e/auth",
  fullyParallel: false, // one shared in-memory API
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      // The e2e user (`e2e-admin`) is on the admin allowlist, so admin-only
      // routes are reachable. In-memory DB → wiped when the process exits.
      command: "pnpm --filter @raidplan/api exec tsx src/server.ts",
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: "development",
        DEV_AUTH: "1",
        DATABASE_PATH: ":memory:",
        ICON_ADMIN_USER_IDS: "e2e-admin",
        WEB_ORIGIN: "http://localhost:4173",
      },
    },
    {
      command: "pnpm build && pnpm preview --port 4173 --strictPort",
      port: 4173,
      reuseExistingServer: !process.env.CI,
      env: { E2E_API: API_ORIGIN },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
