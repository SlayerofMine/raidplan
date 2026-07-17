import type { BuildDetector, FetchFn } from "./types.js";

/**
 * Detect the current live WoW build (plan §11.1 "Refresh detection").
 *
 * A refresh first asks "has the build changed since last time?" and no-ops if
 * not, so a weekly timer costs one small request in steady state. We read the
 * build from wago.tools, which exposes the CDN build info as JSON without any
 * game client.
 */
export const DEFAULT_WAGO_BUILDS_URL = "https://wago.tools/api/builds";

/** Retail live. `wowt`/`wow_beta` are PTR/beta; not what a guild plans against. */
export const DEFAULT_WOW_PRODUCT = "wow";

interface WagoBuild {
  version: string;
  created_at?: string;
}

/**
 * Pick the newest build version for a product from wago's `{ product: [...] }`
 * response. Pure: the API returns newest-first, but we sort by `created_at`
 * defensively rather than trust ordering. Throws a clear error if the product
 * is absent, so a sync fails loudly instead of diffing against "".
 */
export function parseLatestBuild(json: unknown, product: string): string {
  const byProduct = json as Record<string, WagoBuild[] | undefined>;
  const builds = byProduct?.[product];
  if (!Array.isArray(builds) || builds.length === 0) {
    throw new Error(`No builds for product "${product}" in wago response`);
  }
  const newest = [...builds]
    .filter((b) => typeof b?.version === "string")
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
  if (!newest?.version) {
    throw new Error(`No usable version for product "${product}"`);
  }
  return newest.version;
}

export interface WagoBuildDetectorOptions {
  fetchImpl?: FetchFn;
  url?: string;
  product?: string;
}

export function wagoBuildDetector({
  fetchImpl = fetch,
  url = DEFAULT_WAGO_BUILDS_URL,
  product = DEFAULT_WOW_PRODUCT,
}: WagoBuildDetectorOptions = {}): BuildDetector {
  return {
    async currentBuild() {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`Build detection failed: ${res.status} ${url}`);
      }
      return parseLatestBuild(await res.json(), product);
    },
  };
}

/** A fixed build, for tests and for forcing a run without a live check. */
export function staticBuildDetector(build: string): BuildDetector {
  return { currentBuild: async () => build };
}
