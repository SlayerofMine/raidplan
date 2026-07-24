import { defineConfig } from "vitest/config";

// Root config for workspace-wide concerns. Projects themselves are defined in
// `vitest.workspace.ts`; coverage is collected once at the root across every
// project, so it belongs here — the result is a single merged report spanning
// all three packages rather than one report per package.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // One report for the whole monorepo, written to ./coverage.
      reportsDirectory: "coverage",
      // Every source file in every package, so untested files still count
      // against the total instead of silently inflating it.
      all: true,
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/e2e/**",
        "**/dist/**",
      ],
    },
  },
});
