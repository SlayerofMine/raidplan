import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { Layer, Line, Image as KonvaImage, Stage } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { getBackgroundSrc } from "../../assets/backgrounds";
import { useEditorStore } from "../../store/editorStore";
import { isEditableTarget } from "../isEditableTarget";
import { screenToNative } from "./coords";
import { ObjectNode } from "./ObjectNode";
import { SelectionTransformer } from "./SelectionTransformer";
import { useContainerSize } from "./useContainerSize";
import { useImageElement } from "./useImageElement";

const ICON_DATA_TYPE = "application/x-raidplan-icon";
const ZOOM_STEP = 1.1;

/**
 * The Konva canvas (plan §6). Two layers only: a non-interactive background
 * (map image + optional grid, drawn once) and the interactive objects layer
 * with the selection transformer. Wheel zooms to the cursor; holding Space
 * turns the stage into a pan surface. Palette drops are converted to native
 * coordinates and added at the cursor.
 */
export function CanvasStage() {
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
  const addIcon = useEditorStore((s) => s.addIcon);

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

  const handleStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    // A click on empty stage (not on a token) clears the selection.
    if (!isPanning && e.target === e.target.getStage()) clearSelection();
  };

  const handleStageDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const stage = e.target.getStage();
    if (stage && e.target === stage) {
      setView({ scale: view.scale, x: stage.x(), y: stage.y() });
    }
  };

  const handleDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const iconId = e.dataTransfer.getData(ICON_DATA_TYPE);
    const container = containerRef.current;
    if (!iconId || !container) return;
    const rect = container.getBoundingClientRect();
    addIcon(
      iconId,
      screenToNative(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        view,
      ),
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[#0b0d12]"
      style={{ cursor: isPanning ? "grab" : "default" }}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      data-testid="canvas-container"
    >
      <Stage
        width={size.width}
        height={size.height}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable={isPanning}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
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
