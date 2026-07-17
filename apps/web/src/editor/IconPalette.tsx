import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ICON_CATEGORIES,
  searchIcons,
  type IconCategory,
} from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { WowIconGrid } from "./WowIconGrid";
import { ICON_DATA_TYPE } from "./iconDrag";
const COLUMNS = 4;
const ROW_HEIGHT = 56;

/**
 * Left palette (plan §2.1): category filter + free-text search over the icon
 * manifest, rendered through a **virtualized** row list so the palette stays
 * cheap as the manifest grows to hundreds of icons (plan §8.7).
 *
 * Click a token to drop it in the centre of the view, or drag it onto the
 * canvas to place it at the cursor.
 */
export function IconPalette() {
  const addIcon = useEditorStore((s) => s.addIcon);
  const [tab, setTab] = useState<"tokens" | "wow">("tokens");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IconCategory | "all">("all");

  const icons = useMemo(() => searchIcons(query, category), [query, category]);
  const rowCount = Math.ceil(icons.length / COLUMNS);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  return (
    <aside
      aria-label="Icons"
      className="flex h-full min-h-0 flex-col border-r border-panelborder bg-panel"
    >
      <h2 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Icons
      </h2>

      <div
        className="flex gap-1 px-3 pt-1"
        role="tablist"
        aria-label="Icon source"
      >
        <TabButton
          label="Tokens"
          active={tab === "tokens"}
          onClick={() => setTab("tokens")}
        />
        <TabButton
          label="WoW"
          active={tab === "wow"}
          onClick={() => setTab("wow")}
        />
      </div>

      {tab === "wow" ? (
        <WowIconGrid />
      ) : (
        <>
          <div className="flex flex-col gap-2 p-3 pb-2">
            <input
              type="search"
              placeholder="Search icons…"
              aria-label="Search icons"
              data-testid="icon-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm"
            />
            <div className="flex flex-wrap gap-1">
              <CategoryChip
                label="All"
                active={category === "all"}
                onClick={() => setCategory("all")}
              />
              {ICON_CATEGORIES.map((c) => (
                <CategoryChip
                  key={c}
                  label={c}
                  active={category === c}
                  onClick={() => setCategory(c)}
                />
              ))}
            </div>
          </div>

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
          >
            {icons.length === 0 ? (
              <p
                data-testid="palette-empty"
                className="text-sm text-neutral-500"
              >
                No icons match.
              </p>
            ) : (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((row) => (
                  <div
                    key={row.key}
                    className="absolute left-0 grid w-full grid-cols-4 gap-2"
                    style={{
                      height: row.size,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    {icons
                      .slice(row.index * COLUMNS, row.index * COLUMNS + COLUMNS)
                      .map((icon) => (
                        <button
                          key={icon.id}
                          type="button"
                          title={icon.name}
                          aria-label={`Add ${icon.name}`}
                          onClick={() => addIcon(icon.id)}
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer.setData(ICON_DATA_TYPE, icon.id)
                          }
                          className="flex aspect-square items-center justify-center rounded border border-transparent bg-neutral-800/40 p-1 hover:border-accent"
                        >
                          <img
                            src={icon.src}
                            alt={icon.name}
                            className="pointer-events-none h-full w-full"
                            draggable={false}
                          />
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      onClick={onClick}
      aria-selected={active}
      className={`rounded-t border-b-2 px-2 py-1 text-xs font-medium ${
        active
          ? "border-accent text-accent"
          : "border-transparent text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2 py-0.5 text-xs capitalize ${
        active
          ? "border-accent text-accent"
          : "border-panelborder text-neutral-400 hover:border-neutral-500"
      }`}
    >
      {label}
    </button>
  );
}
