import { useEditorStore } from "../store/editorStore";

/**
 * Right panel (plan §1.1). Phase 1 shows a read-only summary of the selection;
 * the full properties panel (x/y, size, rotation, opacity, tint, …) is Phase 2.3.
 */
export function RightPanel() {
  const selectedId = useEditorStore((s) => s.selectedId);
  const object = useEditorStore((s) =>
    s.selectedId ? s.objects[s.selectedId] : undefined,
  );

  return (
    <aside className="flex h-full flex-col border-l border-panelborder bg-panel">
      <h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Properties
      </h2>
      {!object ? (
        <p className="px-3 text-sm text-neutral-500">No selection.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1 px-3 text-sm">
          <dt className="text-neutral-500">Id</dt>
          <dd className="truncate text-neutral-300" title={selectedId ?? ""}>
            {selectedId}
          </dd>
          <dt className="text-neutral-500">Icon</dt>
          <dd className="text-neutral-300">{object.iconId ?? "—"}</dd>
          <dt className="text-neutral-500">X</dt>
          <dd className="tabular-nums text-neutral-300">
            {Math.round(object.base.x)}
          </dd>
          <dt className="text-neutral-500">Y</dt>
          <dd className="tabular-nums text-neutral-300">
            {Math.round(object.base.y)}
          </dd>
        </dl>
      )}
    </aside>
  );
}
