import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated into `./drizzle` and applied by `src/db/migrate.ts`
 * (also run at server start), so a deploy is `pnpm build && restart` with no
 * separate migration step to forget (plan §14 "Updates").
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./data/app.db",
  },
});
