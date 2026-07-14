import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite (plan §13). Kept out of the default `pnpm test` gate because
 * it needs browser binaries (`pnpm exec playwright install`) and a built app;
 * run it explicitly with `pnpm --filter @raidplan/web test:e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm build && pnpm preview --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
