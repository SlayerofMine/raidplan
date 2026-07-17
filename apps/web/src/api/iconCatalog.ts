import {
  IconCatalogPageSchema,
  type IconCatalogCategory,
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
