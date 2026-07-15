import { useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { BACKGROUNDS, isUploadedAsset, toBackground } from "@raidplan/shared";
import { clearHistory, useEditorStore } from "../store/editorStore";
import { useTemporal } from "../store/useTemporal";
import { SCALE_MAX, SCALE_MIN } from "./canvas/coords";
import { downloadPlan, parsePlanJson } from "./planFile";
import { uploadBackground } from "./uploadBackground";

/**
 * Top toolbar (plan §2). Document actions (title, import/export), history,
 * primitive creation, the map picker, view controls, and a live object-count
 * readout — the readout gives the E2E suite a DOM-observable signal, since
 * canvas pixels aren't queryable.
 */
export function Toolbar({
  status,
  viewHref,
}: {
  status?: React.ReactNode;
  /** Where "Play" goes, or null while a server plan's slug is still loading. */
  viewHref?: string | null;
}) {
  const objectCount = useEditorStore((s) => s.objectIds.length);
  const hasSelection = useEditorStore((s) => s.selectedIds.length > 0);
  const title = useEditorStore((s) => s.title);
  const backgroundId = useEditorStore((s) => s.background.assetId);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const view = useEditorStore((s) => s.view);
  const stageSize = useEditorStore((s) => s.stageSize);

  const setTitle = useEditorStore((s) => s.setTitle);
  const setBackground = useEditorStore((s) => s.setBackground);
  const setSnapEnabled = useEditorStore((s) => s.setSnapEnabled);
  const fitToStage = useEditorStore((s) => s.fitToStage);
  const zoomAtPoint = useEditorStore((s) => s.zoomAtPoint);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const addPrimitive = useEditorStore((s) => s.addPrimitive);
  const loadPlan = useEditorStore((s) => s.loadPlan);
  const getPlan = useEditorStore((s) => s.getPlan);

  const { canUndo, canRedo, undo, redo } = useTemporal();
  const fileInput = useRef<HTMLInputElement>(null);
  const mapInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const zoomCentre = (factor: number) =>
    zoomAtPoint({ x: stageSize.width / 2, y: stageSize.height / 2 }, factor);

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = parsePlanJson(await file.text());
    if (result.ok) {
      loadPlan(result.plan);
      clearHistory(); // undo must not step back across an import
    } else {
      // Phase 5.4 replaces this with a proper toast.
      window.alert(result.error);
    }
    e.target.value = ""; // let the same file be picked again
  };

  const handleUploadMap = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      setBackground(await uploadBackground(file));
    } catch (error) {
      // Phase 5.4 replaces this with a proper toast.
      window.alert(
        error instanceof Error ? error.message : "That upload failed.",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-panelborder bg-panel px-3 py-2">
      <span className="font-semibold text-neutral-100">RaidPlans</span>

      <input
        type="text"
        aria-label="Plan title"
        data-testid="plan-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-44 rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm"
      />

      <Divider />

      <Btn onClick={undo} disabled={!canUndo} label="Undo" ariaLabel="Undo" />
      <Btn onClick={redo} disabled={!canRedo} label="Redo" ariaLabel="Redo" />

      <Divider />

      <Btn onClick={() => addPrimitive("text")} label="Text" />
      <Btn onClick={() => addPrimitive("shape", "rect")} label="Rect" />
      <Btn onClick={() => addPrimitive("shape", "circle")} label="Circle" />
      <Btn onClick={() => addPrimitive("shape", "cone")} label="Cone" />
      <Btn onClick={() => addPrimitive("arrow")} label="Arrow" />

      <Divider />

      <Btn
        onClick={duplicateSelected}
        disabled={!hasSelection}
        label="Duplicate"
      />
      <Btn onClick={deleteSelected} disabled={!hasSelection} label="Delete" />

      <Divider />

      <label className="flex items-center gap-1 text-sm text-neutral-400">
        <input
          type="checkbox"
          data-testid="snap-toggle"
          checked={snapEnabled}
          onChange={(e) => setSnapEnabled(e.target.checked)}
        />
        Snap
      </label>

      <select
        aria-label="Map"
        data-testid="map-picker"
        value={backgroundId}
        onChange={(e) => {
          const def = BACKGROUNDS.find((b) => b.assetId === e.target.value);
          if (def) setBackground(toBackground(def));
        }}
        className="rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm"
      >
        {BACKGROUNDS.map((b) => (
          <option key={b.assetId} value={b.assetId}>
            {b.name}
          </option>
        ))}
        {/* An uploaded map isn't in the bundled list, but the picker still has
            to show what's actually selected. */}
        {isUploadedAsset(backgroundId) && (
          <option value={backgroundId}>Uploaded map</option>
        )}
      </select>

      <Btn
        onClick={() => mapInput.current?.click()}
        disabled={uploading}
        label={uploading ? "Uploading…" : "Upload map"}
      />
      <input
        ref={mapInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleUploadMap}
        className="hidden"
        data-testid="upload-map-input"
      />

      <Divider />

      <Btn
        onClick={() => zoomCentre(1 / 1.2)}
        disabled={view.scale <= SCALE_MIN}
        label="−"
        ariaLabel="Zoom out"
      />
      <span
        className="w-14 text-center text-sm tabular-nums text-neutral-300"
        data-testid="zoom-level"
      >
        {Math.round(view.scale * 100)}%
      </span>
      <Btn
        onClick={() => zoomCentre(1.2)}
        disabled={view.scale >= SCALE_MAX}
        label="+"
        ariaLabel="Zoom in"
      />
      <Btn onClick={fitToStage} label="Fit" />

      <Divider />

      {viewHref ? (
        <Link
          to={viewHref}
          data-testid="open-viewer"
          className="rounded border border-panelborder px-2 py-1 text-sm hover:border-accent"
        >
          Play
        </Link>
      ) : (
        <span
          data-testid="open-viewer-pending"
          title="Loading the plan…"
          className="rounded border border-panelborder px-2 py-1 text-sm opacity-40"
        >
          Play
        </span>
      )}
      <Btn onClick={() => downloadPlan(getPlan())} label="Export" />
      <Btn onClick={() => fileInput.current?.click()} label="Import" />
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        onChange={handleImport}
        className="hidden"
        data-testid="import-input"
      />

      <div className="ml-auto flex items-center gap-3">
        {status}
        <span className="text-sm text-neutral-400">
          <span data-testid="object-count">{objectCount}</span> object
          {objectCount === 1 ? "" : "s"}
        </span>
      </div>
    </header>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-panelborder" />;
}

function Btn({
  onClick,
  label,
  ariaLabel,
  disabled,
}: {
  onClick: () => void;
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      className="rounded border border-panelborder px-2 py-1 text-sm hover:border-accent disabled:opacity-40"
    >
      {label}
    </button>
  );
}
