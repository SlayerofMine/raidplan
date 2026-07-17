import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { createIconCatalogRepo } from "./catalogRepo.js";
import { wagoBuildDetector } from "./buildDetector.js";
import { sharpConverter } from "./imageConverter.js";
import { localIconStore } from "./iconStore.js";
import { listfileIndexSource } from "./indexSource.js";
import { packImageSource, wowheadImageSource } from "./imageSource.js";
import type { IconImageSource } from "./types.js";
import type { SyncDeps } from "./syncIcons.js";

/**
 * The composition root for the Icon Sync Service: wire the real seams from
 * config (plan §11.1). This is the one place that knows *which* concrete
 * adapters exist; the orchestrator, routes and CLI depend only on {@link
 * SyncDeps}. Not unit-tested (it is wiring) — the seams and orchestrator it
 * assembles are tested individually.
 */
export interface BuildSyncDepsOptions {
  /** Override the configured bulk source for a one-off run. */
  source?: string;
  log?: (message: string) => void;
}

export function buildSyncDeps(
  db: Db,
  config: Config,
  options: BuildSyncDepsOptions = {},
): SyncDeps {
  const source = options.source ?? config.ICON_SYNC_SOURCE;
  const imageSource: IconImageSource =
    source === "wowhead"
      ? wowheadImageSource()
      : packImageSource({ dir: config.iconPackDir });

  return {
    index: listfileIndexSource(),
    imageSource,
    converter: sharpConverter(),
    store: localIconStore({ dir: config.ICON_DIR }),
    repo: createIconCatalogRepo(db),
    buildDetector: wagoBuildDetector(),
    ...(options.log ? { log: options.log } : {}),
  };
}
