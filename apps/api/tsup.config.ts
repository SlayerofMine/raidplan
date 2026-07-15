import { defineConfig } from "tsup";

// tsup (esbuild) bundles the server to a single ESM file at `dist/server.js` —
// the exact path the systemd unit's ExecStart expects
// (deploy/systemd/raidplans-api.service).
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // tsup keeps everything in `dependencies` external. That's right for real
  // npm packages (and *required* for the native better-sqlite3), but the
  // workspace package ships TypeScript sources: left external, Node would try
  // to `import` its .ts at runtime and die with ERR_MODULE_NOT_FOUND. Inline it.
  noExternal: [/^@raidplan\//],
});
