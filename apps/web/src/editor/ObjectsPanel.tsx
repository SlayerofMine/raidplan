import { useCallback, useRef, useState, type MouseEvent } from "react";
import { LuEye, LuEyeOff, LuLock, LuLockOpen, LuX } from "react-icons/lu";
import { objectsOnSlide } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { objectDisplayName } from "./objectName";

/**
 * The cast of the slide being edited, as a list (plan §2.3 companion).
 *
 * The canvas is the only place an object can be picked today, which fails
 * exactly when picking matters: things stacked on each other, things scrolled
 * off screen, things hidden. So this is a file-manager list — click to select,
 * ctrl/cmd-click to add or remove one, shift-click for everything between —
 * mirroring the canvas selection both ways, because it is the same selection.
 *
 * **Front-most first.** The list reads top-down the way the board is drawn
 * looking down at it, so the row at the top is the thing you'd click on the
 * canvas. `objectIds` runs the other way (back to front, which is what `z`
 * counts), hence the reverse.
 *
 * Only this slide's cast: `slide.states` *is* the membership list, and an
 * object on slide 5 is not on screen here — selecting it would put handles on
 * nothing (see the store's `select`).
 */
export function ObjectsPanel() {
  const objects = useEditorStore((s) => s.objects);
  const objectIds = useEditorStore((s) => s.objectIds);
  const slides = useEditorStore((s) => s.slides);
  const currentSlideIndex = useEditorStore((s) => s.currentSlideIndex);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const updateObject = useEditorStore((s) => s.updateObject);
  const setLocked = useEditorStore((s) => s.setLocked);
  const deleteObjects = useEditorStore((s) => s.deleteObjects);

  /** Which id a shift-click measures its range from — the last plain pick. */
  const anchorRef = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const rows = objectsOnSlide(objectIds, slides, currentSlideIndex)
    .slice()
    .reverse();

  const onPick = useCallback(
    (event: MouseEvent, id: string) => {
      const additive = event.ctrlKey || event.metaKey;
      const anchor = anchorRef.current;

      if (event.shiftKey && anchor && rows.includes(anchor)) {
        const from = rows.indexOf(anchor);
        const to = rows.indexOf(id);
        const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1);
        // Ctrl+shift keeps what's already picked and adds the run, the way a
        // file manager does; shift alone replaces. The anchor stays put either
        // way, so a shift-click can be walked up and down without resetting.
        select(additive ? [...new Set([...selectedIds, ...range])] : range);
        return;
      }

      anchorRef.current = id;
      if (additive) toggleSelect(id);
      else select([id]);
    },
    [rows, select, selectedIds, toggleSelect],
  );

  return (
    <CollapsiblePanel
      id="objects"
      title="Objects"
      aside={rows.length}
      testId="objects-panel"
      className="max-h-64"
    >
      {rows.length === 0 ? (
        <p
          data-testid="no-objects"
          className="px-3 pb-3 text-sm text-neutral-500"
        >
          Nothing on this slide yet.
        </p>
      ) : (
        <ul
          data-testid="object-list"
          className="min-h-0 flex-1 overflow-y-auto px-1 pb-2"
        >
          {rows.map((id) => {
            const object = objects[id];
            if (!object) return null;
            const name = objectDisplayName(object);
            const selected = selectedIds.includes(id);
            const visible =
              slides[currentSlideIndex]?.states[id]?.visible ?? true;
            return (
              <li
                key={id}
                data-testid="object-row"
                data-object-id={id}
                data-selected={selected}
                className={`group flex items-center gap-1 rounded px-1 text-sm ${
                  selected
                    ? "bg-accent/20 text-neutral-100"
                    : "text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {renaming === id ? (
                  <RenameField
                    initial={object.base.name ?? ""}
                    placeholder={name}
                    onDone={(next) => {
                      // Blank means "no name of its own" — the display name
                      // then falls back to the label or the icon, which is
                      // what an author clearing the box is asking for.
                      if (next !== (object.base.name ?? "")) {
                        updateObject(id, { name: next || undefined });
                      }
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={(e) => onPick(e, id)}
                    onDoubleClick={() => setRenaming(id)}
                    title={`${name} — double-click to rename`}
                    className="min-w-0 flex-1 truncate px-1 py-1 text-left"
                  >
                    <span className={visible ? "" : "text-neutral-500 italic"}>
                      {name}
                    </span>
                  </button>
                )}

                <RowButton
                  label={`${visible ? "Hide" : "Show"} ${name}`}
                  active={!visible}
                  onClick={() => updateObject(id, { visible: !visible })}
                >
                  {visible ? <LuEye aria-hidden /> : <LuEyeOff aria-hidden />}
                </RowButton>
                <RowButton
                  label={`${object.locked ? "Unlock" : "Lock"} ${name}`}
                  active={object.locked === true}
                  onClick={() => setLocked(id, !object.locked)}
                >
                  {object.locked ? (
                    <LuLock aria-hidden />
                  ) : (
                    <LuLockOpen aria-hidden />
                  )}
                </RowButton>
                <RowButton
                  label={`Delete ${name}`}
                  onClick={() => deleteObjects([id])}
                  className="hover:text-amber-400"
                >
                  <LuX aria-hidden />
                </RowButton>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsiblePanel>
  );
}

/**
 * A row's icon button. Always rendered rather than revealed on hover: a control
 * that isn't there until the pointer finds it can't be tabbed to.
 */
function RowButton({
  label,
  active,
  onClick,
  className,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-sm leading-none ${
        active ? "opacity-100" : "opacity-60"
      } hover:bg-neutral-700 hover:opacity-100 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

/** In-place rename: Enter or blur commits, Escape abandons. */
function RenameField({
  initial,
  placeholder,
  onDone,
}: {
  initial: string;
  placeholder: string;
  onDone: (name: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <input
      autoFocus
      aria-label={`Rename ${placeholder}`}
      data-testid="object-rename"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onDone(draft.trim())}
      onKeyDown={(e) => {
        // Stopped here so the editor's global hotkeys stay out of a text box.
        e.stopPropagation();
        if (e.key === "Enter") onDone(draft.trim());
        if (e.key === "Escape") onDone(initial);
      }}
      className="min-w-0 flex-1 rounded border border-panelborder bg-neutral-900 px-1 py-0.5 text-sm"
    />
  );
}
