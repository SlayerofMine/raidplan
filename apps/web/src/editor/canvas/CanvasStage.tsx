import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { Layer, Image as KonvaImage, Stage } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { getBackgroundSrc } from "../../assets/background";
import { useEditorStore } from "../../store/editorStore";
import { isEditableTarget } from "../isEditableTarget";
import { screenToNative } from "./coords";
import { ObjectNode } from "./ObjectNode";
import { useContainerSize } from "./useContainerSize";
import { useImageElement } from "./useImageElement";

const ICON_DATA_TYPE = "application/x-raidplan-icon";
const ZOOM_STEP = 1.1;

/**
 * The Konva canvas (plan §1.2–1.5, §6). Owns the stage transform: a background
 * layer (drawn once, non-interactive) and an objects layer. Wheel zooms to the
 * cursor; holding Space turns the stage into a pan surface. HTML5 drops from the
 * palette are converted to native coordinates and added at the drop point.
 */
export function CanvasStage() {
  const [containerRef, size] = useContainerSize<HTMLDivElement>();
  const [isPanning, setIsPanning] = useState(false);
  const didFit = useRef(false);

  const background = useEditorStore((s) => s.background);
  const objectIds = useEditorStore((s) => s.objectIds);
  const view = useEditorStore((s) => s.view);
  const setStageSize = useEditorStore((s) => s.setStageSize);
  const fitToStage = useEditorStore((s) => s.fitToStage);
  const setView = useEditorStore((s) => s.setView);
  const zoomAtPoint = useEditorStore((s) => s.zoomAtPoint);
  const selectObject = useEditorStore((s) => s.selectObject);
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
    if (!isPanning && e.target === e.target.getStage()) selectObject(null);
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
        {/* Background: drawn once, never interactive so clicks fall through. */}
        <Layer listening={false}>
          {bgImage && (
            <KonvaImage
              image={bgImage}
              width={background.width}
              height={background.height}
            />
          )}
        </Layer>
        <Layer>
          {objectIds.map((id) => (
            <ObjectNode key={id} objectId={id} draggable={!isPanning} />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}
