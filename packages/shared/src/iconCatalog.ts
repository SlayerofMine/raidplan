import { z } from "zod";

/**
 * The **synced WoW icon catalog** contract (plan §11.1 source "B").
 *
 * This is deliberately separate from the bundled-icon manifest in
 * `assets/icons.ts` (source "A"): those are a small, versioned set of original
 * tokens shipped in the repo, whereas this describes the large, refreshable
 * library the Icon Sync Service pulls from WoW itself and serves from our own
 * storage. Both the API's `GET /api/icons` feed and the web palette bind to the
 * types here, so the search response can never drift between them.
 *
 * A plan only ever stores an entry's **stable `id`** (the icon's WoW name, e.g.
 * `spell_fire_fireball02`); the URL is resolved at render time and may change
 * when the icon is re-synced. That's the §11.1 "stability contract".
 */

/**
 * Coarse categories derived from an icon's name (§11.1 "Names → categories").
 * `misc` is the catch-all so categorisation is total — every icon lands
 * somewhere and the palette's filter chips are a closed set.
 */
export const ICON_CATALOG_CATEGORIES = [
  "spell",
  "ability",
  "item",
  "class",
  "spec",
  "achievement",
  "trade",
  "ui",
  "misc",
] as const;

export type IconCatalogCategory = (typeof ICON_CATALOG_CATEGORIES)[number];

/** One row of the palette's search feed. */
export const IconCatalogEntrySchema = z.object({
  /** Stable slug = the WoW icon name. This is what a plan references. */
  id: z.string().min(1),
  displayName: z.string(),
  category: z.enum(ICON_CATALOG_CATEGORIES),
  /** 56px thumbnail — the palette grid tiles. */
  url56: z.string().min(1),
  /** 112px — what a token draws at on the canvas (crisper when scaled up). */
  url112: z.string().min(1),
});
export type IconCatalogEntry = z.infer<typeof IconCatalogEntrySchema>;

/**
 * A page of the search feed. `nextCursor` is opaque to the client: it hands it
 * straight back to fetch the next page, and `null` means the end. The feed is
 * always paginated so `GET /api/icons` can never dump ~40k rows (§11.1).
 */
export const IconCatalogPageSchema = z.object({
  items: z.array(IconCatalogEntrySchema),
  nextCursor: z.string().nullable(),
});
export type IconCatalogPage = z.infer<typeof IconCatalogPageSchema>;

/** How many rows one `GET /api/icons` page returns. */
export const ICON_CATALOG_PAGE_SIZE = 60;

/**
 * Query parameters for the search feed. Kept here so the server parser and any
 * client that builds the URL agree on the shape.
 */
export const IconCatalogQuerySchema = z.object({
  query: z.string().trim().max(64).optional(),
  category: z.enum(ICON_CATALOG_CATEGORIES).optional(),
  cursor: z.string().optional(),
});
export type IconCatalogQuery = z.infer<typeof IconCatalogQuerySchema>;
