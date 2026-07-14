import { defineConfig } from "tsup";

// tsup (esbuild) bundles the server to a single ESM file at
// `dist/server.js` — the exact path the systemd unit's ExecStart expects
// (deploy/systemd/raidplans-api.service). Bundling also means workspace
// imports like `@raidplan/shared` are inlined, so the deployed artifact has
// no cross-package resolution to worry about at runtime.
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
});
