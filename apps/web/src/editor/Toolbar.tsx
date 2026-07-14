import { useEditorStore } from "../store/editorStore";
import { SCALE_MAX, SCALE_MIN } from "./canvas/coords";

/**
 * Top toolbar (plan §1.1). Phase 1: view controls (zoom / fit), delete, and a
 * live object-count readout — the readout gives the E2E acceptance ("add 10
 * icons, delete") a DOM-observable signal, since canvas pixels aren't queryable.
 */
export function Toolbar() {
  const objectCount = useEditorStore((s) => s.objectIds.length);
  const hasSelection = useEditorStore((s) => s.selectedId !== null);
  const view = useEditorStore((s) => s.view);
  const stageSize = useEditorStore((s) => s.stageSize);
  const fitToStage = useEditorStore((s) => s.fitToStage);
  const zoomAtPoint = useEditorStore((s) => s.zoomAtPoint);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);

  // Zoom about the centre of the stage for button-driven zoom.
  const zoomCenter = (factor: number) =>
    zoomAtPoint({ x: stageSize.width / 2, y: stageSize.height / 2 }, factor);

  return (
    <header className="flex items-center gap-2 border-b border-panelborder bg-panel px-3 py-2">
      <span className="font-semibold text-neutral-100">RaidPlans</span>
      <span className="text-xs text-neutral-500">editor</span>

      <div className="mx-2 h-5 w-px bg-panelborder" />

      <button
        type="button"
        className="rounded border border-panelborder px-2 py-1 text-sm hover:border-accent disabled:opacity-40"
        onClick={() => zoomCenter(1 / 1.2)}
        disabled={view.scale <= SCALE_MIN}
        aria-label="Zoom out"
      >
        −
      </button>
      <span
        className="w-14 text-center text-sm tabular-nums text-neutral-300"
        data-testid="zoom-level"
      >
        {Math.round(view.scale * 100)}%
      </span>
      <button
        type="button"
        className="rounded border border-panelborder px-2 py-1 text-sm hover:border-accent disabled:opacity-40"
        onClick={() => zoomCenter(1.2)}
        disabled={view.scale >= SCALE_MAX}
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        type="button"
        className="rounded border border-panelborder px-2 py-1 text-sm hover:border-accent"
        onClick={fitToStage}
      >
        Fit
      </button>

      <div className="mx-2 h-5 w-px bg-panelborder" />

      <button
        type="button"
        className="rounded border border-panelborder px-2 py-1 text-sm hover:border-accent disabled:opacity-40"
        onClick={deleteSelected}
        disabled={!hasSelection}
      >
        Delete
      </button>

      <div className="ml-auto text-sm text-neutral-400">
        <span data-testid="object-count">{objectCount}</span> object
        {objectCount === 1 ? "" : "s"}
      </div>
    </header>
  );
}
