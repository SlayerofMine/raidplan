import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import { Layer, Line, Image as KonvaImage, Rect, Stage } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { PlanObject, ShapeKind } from "@raidplan/shared";
import { getBackgroundSrc } from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { isEditableTarget } from "../isEditableTarget";
import {
  ATTACK_DATA_TYPE,
  ICON_DATA_TYPE,
  SHAPE_DATA_TYPE,
} from "../paletteDrag";
import { screenToNative, type Point } from "./coords";
import {
  MARQUEE_THRESHOLD_PX,
  normalizeRect,
  objectsInMarquee,
} from "./marquee";
import { AttackPreviewLayer } from "./AttackPreviewLayer";
import { ObjectNode } from "./ObjectNode";
import { SelectionTransformer } from "./SelectionTransformer";
import { setStageNode } from "./stageHandle";
import { useContainerSize } from "./useContainerSize";
import { useImageElement } from "./useImageElement";

/** An in-progress rubber-band sweep, in native coordinates. */
interface Marquee {
  start: Point;
  current: Point;
}

const ZOOM_STEP = 1.1;

/**
 * The Konva canvas (plan §6). Two layers only: a non-interactive background
 * (map image + optional grid, drawn once) and the interactive objects layer
 * with the selection transformer. Wheel zooms to the cursor; holding Space
 * turns the stage into a pan surface. Palette drops are converted to native
 * coordinates and added at the cursor.
 */
export function CanvasStage({ overlay }: { overlay?: ReactNode } = {}) {
  const [containerRef, size] = useContainerSize<HTMLDivElement>();
  const [isPanning, setIsPanning] = useState(false);
  const didFit = useRef(false);

  const background = useEditorStore((s) => s.background);
  const objectIds = useEditorStore((s) => s.objectIds);
  const view = useEditorStore((s) => s.view);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const gridSize = useEditorStore((s) => s.gridSize);
  const setStageSize = useEditorStore((s) => s.setStageSize);
  const fitToStage = useEditorStore((s) => s.fitToStage);
  const setView = useEditorStore((s) => s.setView);
  const zoomAtPoint = useEditorStore((s) => s.zoomAtPoint);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const select = useEditorStore((s) => s.select);
  const addIcon = useEditorStore((s) => s.addIcon);
  const addPrimitive = useEditorStore((s) => s.addPrimitive);
  const addAttack = useEditorStore((s) => s.addAttack);

  // The sweep lives in state (to draw it) and a ref (to read it from the
  // window-level mouseup without stale-closure games).
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const marqueeAdditive = useRef(false);

  const updateMarquee = useCallback((next: Marquee | null) => {
    marqueeRef.current = next;
    setMarquee(next);
  }, []);

  const bgImage = useImageElement(getBackgroundSrc(background.assetId));

  // Keep the store's stage size current; fit the plan once, on first measure.
  useEffect(() => {
    setStageSize(size);
    if (!didFit.current && size.width > 0 && size.height > 0) {
      didFit.current = true;
      fitToStage();
    }
  }, [size, setStageSize, fitToStage]);

  // Space toggles pan mode (ignored while typing).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isEditableTarget(e.target)) {
        e.preventDefault();
        setIsPanning(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setIsPanning(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pointer = e.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    zoomAtPoint(pointer, e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  };

  /**
   * Pressing empty space begins a rubber-band sweep; pressing a token drags it
   * (the node handles that), and Space+drag pans — so left-drag is unambiguous
   * and needs no mode switch.
   */
  const handleStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (isPanning) return;
    const stage = e.target.getStage();
    if (!stage || e.target !== stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    marqueeAdditive.current = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
    const start = screenToNative(pointer, view);
    updateMarquee({ start, current: start });
  };

  const handleStageMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    if (!marqueeRef.current) return;
    const pointer = e.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    updateMarquee({
      start: marqueeRef.current.start,
      current: screenToNative(pointer, view),
    });
  };

  const finishMarquee = useCallback(() => {
    const sweep = marqueeRef.current;
    if (!sweep) return;
    updateMarquee(null);

    const rect = normalizeRect(sweep.start, sweep.current);
    // A press that never really moved is a plain click, not a sweep.
    const dragged =
      Math.max(rect.width, rect.height) * view.scale >= MARQUEE_THRESHOLD_PX;
    if (!dragged) {
      if (!marqueeAdditive.current) clearSelection();
      return;
    }

    const { objects, objectIds, selectedIds } = useEditorStore.getState();
    const ordered = objectIds
      .map((id) => objects[id])
      .filter((o): o is PlanObject => o !== undefined);
    const swept = objectsInMarquee(ordered, rect);

    select(
      marqueeAdditive.current
        ? [...new Set([...selectedIds, ...swept])]
        : swept,
    );
  }, [view.scale, clearSelection, select, updateMarquee]);

  // Finish on mouseup anywhere, so releasing outside the canvas can't strand
  // the sweep.
  useEffect(() => {
    window.addEventListener("mouseup", finishMarquee);
    return () => window.removeEventListener("mouseup", finishMarquee);
  }, [finishMarquee]);

  const handleStageDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const stage = e.target.getStage();
    if (stage && e.target === stage) {
      setView({ scale: view.scale, x: stage.x(), y: stage.y() });
    }
  };

  /** Palette drops land at the cursor, whatever kind of tile was dragged. */
  const handleDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const at = screenToNative(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      view,
    );

    const iconId = e.dataTransfer.getData(ICON_DATA_TYPE);
    if (iconId) return void addIcon(iconId, at);

    const shape = e.dataTransfer.getData(SHAPE_DATA_TYPE);
    if (shape) {
      // "text"/"arrow" are primitives in their own right; the rest are shapes.
      if (shape === "text" || shape === "arrow")
        addPrimitive(shape, undefined, at);
      else addPrimitive("shape", shape as ShapeKind, at);
      return;
    }

    const attackId = e.dataTransfer.getData(ATTACK_DATA_TYPE);
    if (attackId) addAttack(attackId, at);
  };

  return (
    <div
      ref={containerRef}
      // A custom canvas widget: label it and let it own the keyboard (plan
      // §5.3). The board's shortcuts live in `useEditorHotkeys`.
      role="application"
      aria-label="Plan canvas"
      className="relative h-full w-full overflow-hidden bg-[#0b0d12]"
      style={{ cursor: isPanning ? "grab" : "default" }}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      data-testid="canvas-container"
    >
      <Stage
        // Register the node for PNG export (plan §5.1).
        ref={setStageNode}
        width={size.width}
        height={size.height}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable={isPanning}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onDragEnd={handleStageDragEnd}
      >
        {/* Background + grid: never interactive, so clicks fall through. */}
        <Layer listening={false}>
          {bgImage && (
            <KonvaImage
              image={bgImage}
              width={background.width}
              height={background.height}
            />
          )}
          {snapEnabled && (
            <GridLines
              width={background.width}
              height={background.height}
              size={gridSize}
            />
          )}
        </Layer>
        <Layer>
          {objectIds.map((id) => (
            <ObjectNode key={id} objectId={id} draggable={!isPanning} />
          ))}
          {/* Placed attacks, drawn read-only above the plan's own objects. */}
          <AttackPreviewLayer />
          {/* Chrome only one caller wants — the designer's bounding box. */}
          {overlay}
          {marquee && (
            <Rect
              {...normalizeRect(marquee.start, marquee.current)}
              fill="#4f9dff22"
              stroke="#4f9dff"
              strokeWidth={1}
              dash={[4, 4]}
              strokeScaleEnabled={false}
              listening={false}
            />
          )}
          <SelectionTransformer />
        </Layer>
      </Stage>
    </div>
  );
}

/** The snapping grid, drawn in native space over the map (plan §2.6). */
function GridLines({
  width,
  height,
  size,
}: {
  width: number;
  height: number;
  size: number;
}) {
  if (size <= 0) return null;
  const lines = [];
  for (let x = size; x < width; x += size) {
    lines.push(
      <Line
        key={`v${x}`}
        points={[x, 0, x, height]}
        stroke="#2b3a55"
        strokeWidth={1}
        opacity={0.5}
      />,
    );
  }
  for (let y = size; y < height; y += size) {
    lines.push(
      <Line
        key={`h${y}`}
        points={[0, y, width, y]}
        stroke="#2b3a55"
        strokeWidth={1}
        opacity={0.5}
      />,
    );
  }
  return <>{lines}</>;
}
