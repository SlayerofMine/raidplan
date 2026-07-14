import { ICONS } from "../assets/icons";
import { useEditorStore } from "../store/editorStore";

const ICON_DATA_TYPE = "application/x-raidplan-icon";

/**
 * Left palette (plan §1.6). Click a token to drop it in the centre of the view,
 * or drag it onto the canvas to place it at the cursor. Phase 2.1 makes this
 * manifest-driven, searchable, and virtualized.
 */
export function IconPalette() {
  const addIcon = useEditorStore((s) => s.addIcon);

  return (
    <aside className="flex h-full flex-col border-r border-panelborder bg-panel">
      <h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Icons
      </h2>
      <div className="grid grid-cols-4 gap-2 overflow-y-auto p-3">
        {ICONS.map((icon) => (
          <button
            key={icon.id}
            type="button"
            title={icon.name}
            aria-label={`Add ${icon.name}`}
            onClick={() => addIcon(icon.id)}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(ICON_DATA_TYPE, icon.id)}
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
    </aside>
  );
}
