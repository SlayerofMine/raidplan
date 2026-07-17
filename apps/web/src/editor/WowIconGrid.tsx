import { useCallback, useEffect, useRef, useState } from "react";
import {
  ICON_CATALOG_CATEGORIES,
  type IconCatalogCategory,
  type IconCatalogEntry,
} from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { fetchIconCatalog, IconCatalogError } from "../api/iconCatalog";
import { registerSyncedIconUrl } from "./iconSrc";
import { ICON_DATA_TYPE } from "./iconDrag";

/**
 * The synced WoW icon browser (plan §11.1 "Frontend integration").
 *
 * Unlike the bundled palette this is **server-backed**: search and pagination
 * happen in `GET /api/icons`, and results stream in a page at a time. Images use
 * `loading="lazy"` so only the tiles actually scrolled into view fetch bytes —
 * which is what keeps the grid cheap as thousands of icons accumulate, without
 * the machinery of windowing a list whose length the server, not the client,
 * decides.
 *
 * Placing a synced icon stores its **stable id** (like the bundled tiles); its
 * URL is registered for the canvas resolver as results arrive.
 */
const DEBOUNCE_MS = 250;

type Status = "idle" | "loading" | "error";

export function WowIconGrid() {
  const addIcon = useEditorStore((s) => s.addIcon);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<IconCatalogCategory | "">("");
  const [items, setItems] = useState<IconCatalogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  // Debounce keystrokes so we don't fire a request per character.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Only the most recent load may commit: a slow first page must not overwrite
  // a newer query's results.
  const loadSeq = useRef(0);

  const load = useCallback(
    async (reset: boolean, nextCursor?: string) => {
      const seq = ++loadSeq.current;
      setStatus("loading");
      try {
        const page = await fetchIconCatalog({
          query: debounced || undefined,
          category: category || undefined,
          cursor: reset ? undefined : nextCursor,
        });
        if (seq !== loadSeq.current) return; // superseded by a newer load
        for (const item of page.items) {
          // The grid tiles show the 56px thumbnail, but a placed token draws at
          // 112px on the canvas — register the larger one for the resolver.
          registerSyncedIconUrl(item.id, item.url112);
        }
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
        setCursor(page.nextCursor);
        setStatus("idle");
      } catch (error) {
        if (seq !== loadSeq.current) return;
        setErrorStatus(error instanceof IconCatalogError ? error.status : 0);
        setStatus("error");
      }
    },
    [debounced, category],
  );

  // Reload from the top when the query or category changes.
  useEffect(() => {
    void load(true);
  }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 px-3 pb-2">
        <input
          type="search"
          placeholder="Search WoW icons…"
          aria-label="Search WoW icons"
          data-testid="wow-icon-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm"
        />
        <select
          aria-label="Filter WoW icons by category"
          value={category}
          onChange={(e) =>
            setCategory(e.target.value as IconCatalogCategory | "")
          }
          className="rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm capitalize"
        >
          <option value="">All categories</option>
          {ICON_CATALOG_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {status === "error" ? (
          <p data-testid="wow-error" className="text-sm text-neutral-500">
            {errorStatus === 401
              ? "Sign in to browse WoW icons."
              : "Couldn't load icons. Is the catalog synced?"}
          </p>
        ) : items.length === 0 && status !== "loading" ? (
          <p data-testid="wow-empty" className="text-sm text-neutral-500">
            No WoW icons found.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              {items.map((icon) => (
                <button
                  key={icon.id}
                  type="button"
                  title={icon.displayName}
                  aria-label={`Add ${icon.displayName}`}
                  onClick={() => addIcon(icon.id)}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData(ICON_DATA_TYPE, icon.id)
                  }
                  className="flex aspect-square items-center justify-center rounded border border-transparent bg-neutral-800/40 p-1 hover:border-accent"
                >
                  <img
                    src={icon.url56}
                    alt={icon.displayName}
                    loading="lazy"
                    className="pointer-events-none h-full w-full"
                    draggable={false}
                  />
                </button>
              ))}
            </div>

            {status === "loading" && (
              <p className="pt-3 text-center text-xs text-neutral-500">
                Loading…
              </p>
            )}
            {cursor && status !== "loading" && (
              <button
                type="button"
                onClick={() => load(false, cursor)}
                className="mt-3 w-full rounded border border-panelborder py-1 text-sm text-neutral-300 hover:border-accent"
              >
                Load more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
