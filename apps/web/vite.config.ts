import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `vitest/config` re-exports Vite's `defineConfig` with the `test` field typed,
// so the build and unit-test configuration live in one file.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Playwright owns the browser end-to-end suite (see playwright.config.ts).
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
