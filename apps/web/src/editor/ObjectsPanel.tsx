import { useCallback, useRef, useState, type MouseEvent } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuEye,
  LuEyeOff,
  LuLock,
  LuLockOpen,
  LuUngroup,
  LuX,
} from "react-icons/lu";
import { objectsOnSlide, type PlanObject } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { objectDisplayName } from "./objectName";

/**
 * One line of the panel: a loose object, or a group standing in for its members
 * (plan §18.1).
 */
type Row =
  | { kind: "object"; id: string }
  | { kind: "group"; groupId: string; members: string[] };

/**
 * Fold the slide's cast into rows, gathering each group at its front-most
 * member. Members are contiguous in the z-order as a rule (the store gathers
 * them when the group is made), but this collects them by id rather than by
 * adjacency so a document written before that rule — or one hand-edited since —
 * still shows each group as one thing instead of several.
 */
function toRows(
  ids: readonly string[],
  objects: Record<string, PlanObject>,
): Row[] {
  const rows: Row[] = [];
  const placed = new Set<string>();
  for (const id of ids) {
    const groupId = objects[id]?.groupId;
    if (!groupId) {
      rows.push({ kind: "object", id });
      continue;
    }
    if (placed.has(groupId)) continue;
    placed.add(groupId);
    rows.push({
      kind: "group",
      groupId,
      members: ids.filter((m) => objects[m]?.groupId === groupId),
    });
  }
  return rows;
}

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
 * **Groups are containers** (plan §18.1): one row for the group, its members
 * folded away underneath. That makes this the place a group is taken apart —
 * on the canvas a click deliberately means the whole group, so a panel that
 * only mirrored the canvas would leave no way to reach one member of six
 * except by ungrouping. Picking a member's row here selects that member alone,
 * exactly as it does in a layers panel anywhere else; alt-clicking it on the
 * board does the same.
 *
 * Only this slide's cast: `slide.states` *is* the membership list, and an
 * object on slide 5 is not on screen here — selecting it would put handles on
 * nothing (see the store's `select`).
 */
export function ObjectsPanel() {
  const objects = useEditorStore((s) => s.objects);
  const objectIds = useEditorStore((s) => s.objectIds);
  const groups = useEditorStore((s) => s.groups);
  const slides = useEditorStore((s) => s.slides);
  const currentSlideIndex = useEditorStore((s) => s.currentSlideIndex);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const select = useEditorStore((s) => s.select);
  const selectOnly = useEditorStore((s) => s.selectOnly);
  const selectGroup = useEditorStore((s) => s.selectGroup);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const updateObject = useEditorStore((s) => s.updateObject);
  const setLocked = useEditorStore((s) => s.setLocked);
  const setGroupLocked = useEditorStore((s) => s.setGroupLocked);
  const setGroupVisible = useEditorStore((s) => s.setGroupVisible);
  const renameGroup = useEditorStore((s) => s.renameGroup);
  const ungroup = useEditorStore((s) => s.ungroup);
  const deleteObjects = useEditorStore((s) => s.deleteObjects);

  /** Which id a shift-click measures its range from — the last plain pick. */
  const anchorRef = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /**
   * Which groups are folded open. Groups start **shut**, because a group is a
   * way of having fewer things to look at — one that opened itself would just
   * be the flat list again with indentation.
   */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  const ids = objectsOnSlide(objectIds, slides, currentSlideIndex)
    .slice()
    .reverse();
  const rows = toRows(ids, objects);

  const isVisible = (id: string) =>
    slides[currentSlideIndex]?.states[id]?.visible ?? true;

  /**
   * Pick a **loose** object — the behaviour this panel has always had, where a
   * click means the same thing it means on the canvas and so takes the whole
   * group if the object is in one.
   */
  const onPick = useCallback(
    (event: MouseEvent, id: string) => {
      const additive = event.ctrlKey || event.metaKey;
      const anchor = anchorRef.current;

      if (event.shiftKey && anchor && ids.includes(anchor)) {
        const from = ids.indexOf(anchor);
        const to = ids.indexOf(id);
        const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
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
    [ids, select, selectedIds, toggleSelect],
  );

  /**
   * Pick one **member** of a group. Everything here goes through `selectOnly`,
   * so a member is reached without its group coming with it — including the
   * ctrl-click, which would otherwise toggle all six.
   */
  const onPickMember = useCallback(
    (event: MouseEvent, id: string) => {
      anchorRef.current = id;
      if (event.ctrlKey || event.metaKey) {
        selectOnly(
          selectedIds.includes(id)
            ? selectedIds.filter((x) => x !== id)
            : [...selectedIds, id],
        );
      } else selectOnly([id]);
    },
    [selectOnly, selectedIds],
  );

  /** Pick a whole group from its header row. */
  const onPickGroup = useCallback(
    (event: MouseEvent, groupId: string, members: string[]) => {
      anchorRef.current = members[0] ?? null;
      if (!(event.ctrlKey || event.metaKey)) {
        selectGroup(groupId);
        return;
      }
      // Add or remove the group as a unit, leaving the rest of the selection —
      // and any other group in it — exactly as it was.
      const whole = members.every((m) => selectedIds.includes(m));
      selectOnly(
        whole
          ? selectedIds.filter((x) => !members.includes(x))
          : [...new Set([...selectedIds, ...members])],
      );
    },
    [selectGroup, selectOnly, selectedIds],
  );

  /**
   * One object's row. `member` says it sits inside an open group, which changes
   * what a click means — the member alone rather than the whole group.
   */
  const objectRow = (id: string, member: boolean) => {
    const object = objects[id];
    if (!object) return null;
    const name = objectDisplayName(object);
    const selected = selectedIds.includes(id);
    const visible = isVisible(id);
    return (
      <li
        key={id}
        data-testid="object-row"
        data-object-id={id}
        data-selected={selected}
        data-member={member || undefined}
        className={`group flex items-center gap-1 rounded px-1 text-sm ${
          member ? "ml-3 border-l border-panelborder pl-1" : ""
        } ${
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
            onClick={(e) => (member ? onPickMember(e, id) : onPick(e, id))}
            onDoubleClick={() => setRenaming(id)}
            title={
              member
                ? `${name} — on its own, out of its group. Double-click to rename`
                : `${name} — double-click to rename`
            }
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
          {object.locked ? <LuLock aria-hidden /> : <LuLockOpen aria-hidden />}
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
  };

  /**
   * A group's header row: what the group is called, and the things you can say
   * about all of it at once.
   *
   * Lock and visibility read the members rather than a stored group flag —
   * "locked" means every member is, "visible" means any member is — so a group
   * one of whose members was locked on its own says so instead of claiming a
   * tidiness it doesn't have.
   */
  const groupRow = (groupId: string, members: string[]) => {
    const name = groups[groupId] ?? "Group";
    const open = opened.has(groupId);
    const selectedHere = members.filter((m) => selectedIds.includes(m)).length;
    const whole = selectedHere === members.length;
    const locked = members.every((m) => objects[m]?.locked === true);
    const visible = members.some((m) => isVisible(m));
    return (
      <li key={groupId} data-testid="group-item" data-group-id={groupId}>
        <div
          data-testid="group-row"
          data-selected={whole}
          data-partial={selectedHere > 0 && !whole}
          className={`flex items-center gap-1 rounded px-1 text-sm ${
            whole
              ? "bg-accent/20 text-neutral-100"
              : selectedHere > 0
                ? "bg-accent/5 text-neutral-200"
                : "text-neutral-300 hover:bg-neutral-800"
          }`}
        >
          <RowButton
            label={`${open ? "Collapse" : "Expand"} ${name}`}
            testId="group-toggle"
            onClick={() =>
              setOpened((was) => {
                const next = new Set(was);
                if (!next.delete(groupId)) next.add(groupId);
                return next;
              })
            }
          >
            {open ? (
              <LuChevronDown aria-hidden />
            ) : (
              <LuChevronRight aria-hidden />
            )}
          </RowButton>

          {renaming === groupId ? (
            <RenameField
              initial={groups[groupId] ?? ""}
              placeholder={name}
              onDone={(next) => {
                renameGroup(groupId, next);
                setRenaming(null);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={(e) => onPickGroup(e, groupId, members)}
              onDoubleClick={() => setRenaming(groupId)}
              title={`${name} — selects all ${members.length}. Double-click to rename`}
              className="min-w-0 flex-1 truncate px-1 py-1 text-left"
            >
              {name}{" "}
              <span className="text-xs text-neutral-500">{members.length}</span>
            </button>
          )}

          <RowButton
            label={`${visible ? "Hide" : "Show"} ${name}`}
            active={!visible}
            onClick={() => setGroupVisible(groupId, !visible)}
          >
            {visible ? <LuEye aria-hidden /> : <LuEyeOff aria-hidden />}
          </RowButton>
          <RowButton
            label={`${locked ? "Unlock" : "Lock"} ${name}`}
            active={locked}
            onClick={() => setGroupLocked(groupId, !locked)}
          >
            {locked ? <LuLock aria-hidden /> : <LuLockOpen aria-hidden />}
          </RowButton>
          <RowButton
            label={`Ungroup ${name}`}
            testId="group-ungroup"
            onClick={() => ungroup(groupId)}
          >
            <LuUngroup aria-hidden />
          </RowButton>
          <RowButton
            label={`Delete ${name}`}
            onClick={() => deleteObjects(members)}
            className="hover:text-amber-400"
          >
            <LuX aria-hidden />
          </RowButton>
        </div>

        {open && (
          <ul data-testid="group-members">
            {members.map((m) => objectRow(m, true))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <CollapsiblePanel
      id="objects"
      title="Objects"
      aside={ids.length}
      testId="objects-panel"
      className="max-h-64"
    >
      {ids.length === 0 ? (
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
          {rows.map((row) =>
            row.kind === "group"
              ? groupRow(row.groupId, row.members)
              : objectRow(row.id, false),
          )}
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
  testId,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  className?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
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
