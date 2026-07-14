// Flat ESLint config (ESLint 9) shared across the whole monorepo. One config,
// resolved from the repo root, keeps the lint contract identical for every
// package while layering browser/React rules only where they apply (apps/web).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    // Never lint generated or vendored output.
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Node is the default runtime (api, config files, tests).
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // The browser SPA: React Hooks correctness + Fast Refresh hygiene.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // Project-wide rule tweaks. `_`-prefixed args/vars are intentional throwaways.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
