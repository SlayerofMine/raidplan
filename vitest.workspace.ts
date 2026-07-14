import { defineWorkspace } from "vitest/config";

// A single command (`pnpm -w vitest`) runs every package's suite, while each
// package keeps its own `test` script for isolated runs and CI granularity.
export default defineWorkspace(["packages/*", "apps/*"]);
