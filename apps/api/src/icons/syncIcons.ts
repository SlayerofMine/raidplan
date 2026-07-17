import { contentHash } from "./contentHash.js";
import { ICON_SIZES } from "./types.js";
import type {
  BuildDetector,
  IconImageSource,
  IconIndexSource,
  ImageConverter,
  IconStore,
} from "./types.js";
import type { IconCatalogRepo } from "./catalogRepo.js";

/**
 * The icon-sync orchestrator (plan §11.1 pipeline).
 *
 * Pure control flow over the injected seams — detect build → no-op if unchanged
 * → list → diff → fetch/convert/store → upsert → deprecate missing → record the
 * run. Because every boundary is an interface, this is exercised end-to-end in
 * tests with in-memory fakes and never touches the network, sharp or disk.
 *
 * **Incremental by default:** only icons *new* to the catalog are fetched, so a
 * steady-state weekly refresh pulls just the handful a patch adds. `force`
 * re-fetches everything and picks up content changes to existing icons.
 */
export interface SyncDeps {
  index: IconIndexSource;
  imageSource: IconImageSource;
  converter: ImageConverter;
  store: IconStore;
  repo: IconCatalogRepo;
  buildDetector: BuildDetector;
  /** Optional progress logging; defaults to silent. */
  log?: (message: string) => void;
}

export interface SyncOptions {
  force?: boolean;
}

export interface SyncResult {
  runId: string;
  build: string | null;
  added: number;
  updated: number;
  removed: number;
  /** True when the build was unchanged and nothing was done. */
  skipped: boolean;
}

/**
 * Begin a sync. Creates the run row synchronously and returns its id together
 * with a promise that resolves when the (potentially minutes-long) job
 * finishes. The HTTP route returns the id and ignores the promise; tests await
 * it. See plan §11.1 "kicks off the job async".
 */
export function startSync(
  deps: SyncDeps,
  options: SyncOptions = {},
): { runId: string; done: Promise<SyncResult> } {
  const runId = deps.repo.startRun();
  return { runId, done: runSync(deps, runId, options) };
}

async function runSync(
  deps: SyncDeps,
  runId: string,
  { force = false }: SyncOptions,
): Promise<SyncResult> {
  const { index, imageSource, converter, store, repo, buildDetector } = deps;
  const log = deps.log ?? (() => {});

  try {
    const build = await buildDetector.currentBuild();
    const lastBuild = repo.lastCompletedBuild();

    if (build === lastBuild && !force) {
      log(`Build ${build} unchanged; nothing to sync.`);
      repo.finishRun(runId, {
        build,
        added: 0,
        updated: 0,
        removed: 0,
        status: "ok",
      });
      return { runId, build, added: 0, updated: 0, removed: 0, skipped: true };
    }

    const indexEntries = await index.listIcons();
    const existing = repo.listExisting();
    log(
      `Build ${build}: ${indexEntries.length} icons in index, ` +
        `${existing.size} in catalog.`,
    );

    let added = 0;
    let updated = 0;

    for (const entry of indexEntries) {
      const current = existing.get(entry.name);
      // Incremental: skip icons we already have unless forced to re-check.
      if (current && !force) continue;

      let bytes: Uint8Array | null;
      try {
        bytes = await imageSource.fetchImage(entry);
      } catch (error) {
        // One flaky fetch must not abort a 40k-icon run.
        log(`Skipping ${entry.name}: ${errorMessage(error)}`);
        continue;
      }
      if (!bytes) continue;

      const hash = contentHash(bytes);
      // On a forced re-check, unchanged bytes need no re-store or write.
      if (current && current.contentHash === hash) continue;

      const [small, large] = await Promise.all([
        converter.toWebp(bytes, ICON_SIZES.small),
        converter.toWebp(bytes, ICON_SIZES.large),
      ]);
      const [url56, url112] = await Promise.all([
        store.put(hash, ICON_SIZES.small, small),
        store.put(hash, ICON_SIZES.large, large),
      ]);

      repo.upsertIcon({
        id: entry.name,
        fileDataId: entry.fileDataId,
        contentHash: hash,
        url56,
        url112,
        source: imageSource.name,
        firstSeenBuild: build,
      });
      if (current) updated++;
      else added++;
    }

    const present = new Set(indexEntries.map((e) => e.name));
    const removed = repo.reconcileDeprecation(present);

    log(`Done: +${added} icons, ~${updated} changed, -${removed} deprecated.`);
    repo.finishRun(runId, { build, added, updated, removed, status: "ok" });
    return { runId, build, added, updated, removed, skipped: false };
  } catch (error) {
    const message = errorMessage(error);
    log(`Sync failed: ${message}`);
    repo.failRun(runId, message);
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
