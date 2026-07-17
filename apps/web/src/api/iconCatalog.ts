import {
  IconCatalogEntrySchema,
  IconCatalogPageSchema,
  type IconCatalogCategory,
  type IconCatalogEntry,
  type IconCatalogPage,
} from "@raidplan/shared";

/**
 * Client for the synced WoW icon catalog (plan §11.1). Thin and pure: it builds
 * the request, validates the response against the shared schema, and returns
 * it. Registering URLs for the canvas resolver is the caller's job, so this
 * stays trivial to test with a stubbed fetch.
 */
export class IconCatalogError extends Error {
  constructor(readonly status: number) {
    super(`Icon search failed (${status})`);
    this.name = "IconCatalogError";
  }
}

export interface IconSearchParams {
  query?: string;
  category?: IconCatalogCategory | undefined;
  cursor?: string | undefined;
}

export async function fetchIconCatalog(
  params: IconSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<IconCatalogPage> {
  const qs = new URLSearchParams();
  if (params.query) qs.set("query", params.query);
  if (params.category) qs.set("category", params.category);
  if (params.cursor) qs.set("cursor", params.cursor);

  // Same-origin in prod (Caddy) and via the Vite proxy in dev; the session
  // cookie must ride along because the feed is guild-readable.
  const res = await fetchImpl(`/api/icons?${qs.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new IconCatalogError(res.status);
  return IconCatalogPageSchema.parse(await res.json());
}

/** The `/api/icons/resolve` payload is `{ items: [...] }`. */
const ResolveItemsSchema = IconCatalogEntrySchema.array();

/**
 * Resolve a plan's stable icon ids to their current URLs (plan §11.1). This is
 * the open, no-auth counterpart to the search feed — it's how a loaded plan
 * turns the synced ids it stored back into drawable images, including ids that
 * were later deprecated. Chunked so a huge plan can't exceed the endpoint's
 * per-request id cap.
 */
const RESOLVE_CHUNK = 200;

export async function resolveIcons(
  ids: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<IconCatalogEntry[]> {
  const out: IconCatalogEntry[] = [];
  for (let i = 0; i < ids.length; i += RESOLVE_CHUNK) {
    const chunk = ids.slice(i, i + RESOLVE_CHUNK);
    const res = await fetchImpl(
      `/api/icons/resolve?ids=${encodeURIComponent(chunk.join(","))}`,
      { credentials: "include" },
    );
    if (!res.ok) throw new IconCatalogError(res.status);
    const body = (await res.json()) as { items?: unknown };
    out.push(...ResolveItemsSchema.parse(body.items ?? []));
  }
  return out;
}
