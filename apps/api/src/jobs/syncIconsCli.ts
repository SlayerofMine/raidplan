import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../config.js";
import { openDb } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { buildSyncDeps } from "../icons/syncDeps.js";
import { startSync } from "../icons/syncIcons.js";

/**
 * One-shot icon-sync entry point (plan §11.1 "systemd timer").
 *
 * The scheduled refresh runs this, not an HTTP call, so a sync needs no admin
 * session and doesn't tie up the web process. It opens and migrates the same
 * database the server uses, runs a single sync to completion, logs a summary
 * and exits — 0 on success, 1 on failure so systemd records the run correctly.
 *
 * Pass `--force` to re-fetch every icon (picks up art changes on an unchanged
 * build) and `--source=<name>` to override the configured bulk source.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (config.DATABASE_PATH !== ":memory:") {
    mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
  }

  const { db, close } = openDb(config.DATABASE_PATH);
  try {
    runMigrations(db);

    const force = process.argv.includes("--force");
    const sourceArg = process.argv
      .find((a) => a.startsWith("--source="))
      ?.slice("--source=".length);
    const log = (message: string) => console.log(`[icon-sync] ${message}`);

    const deps = buildSyncDeps(db, config, {
      log,
      ...(sourceArg ? { source: sourceArg } : {}),
    });
    const { runId, done } = startSync(deps, { force });
    log(`run ${runId} started`);
    const result = await done;
    log(
      `finished: +${result.added} added, ~${result.updated} changed, ` +
        `-${result.removed} deprecated ` +
        `(build ${result.build ?? "unknown"}${result.skipped ? ", unchanged" : ""})`,
    );
  } finally {
    close();
  }
}

main().catch((error) => {
  console.error(
    "[icon-sync] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
