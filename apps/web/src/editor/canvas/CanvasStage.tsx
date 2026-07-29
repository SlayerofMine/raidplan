import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import {
  Group,
  Layer,
  Line,
  Image as KonvaImage,
  Rect,
  Stage,
} from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Stage as StageNode } from "konva/lib/Stage";
import type { PlanObject, ShapeKind } from "@raidplan/shared";
import { getBackgroundSrc, resolveObjectState } from "@raidplan/shared";
import { useFollowing } from "../../anim/useFollowing";
import { boardStack, useEditorStore } from "../../store/editorStore";
import {
  selectSelectionSizes,
  selectSoleAttackId,
} from "../../store/selectors";
import { isEditableTarget } from "../isEditableTarget";
import {
  ATTACK_DATA_TYPE,
  ICON_DATA_TYPE,
  SHAPE_DATA_TYPE,
} from "../paletteDrag";
import { useAttackPlacement } from "../useAttackPlacement";
import { selectPlaybackLocked, usePlayhead } from "../timeline/playhead";
import { screenToNative, type Point } from "./coords";
import { snapValue } from "./snapping";
import {
  MARQUEE_THRESHOLD_PX,
  normalizeRect,
  objectsInMarquee,
} from "./marquee";
import { ObjectNode } from "./ObjectNode";
import { MotionPathLayer } from "./MotionPathLayer";
import { MoveDraftLayer } from "./MoveDraftLayer";
import {
  finishMoveDraft,
  useMoveDraft,
  useMoveDraftKeys,
} from "./useMoveDraft";
import { OriginHandle } from "./OriginHandle";
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
/** How close the second click of a double-click must land, in screen pixels. */
const DBLCLICK_SLOP_PX = 8;

/**
 * The Konva canvas (plan §6). Two layers only: a non-interactive background
 * (map image + optional grid, drawn once) and the interactive objects layer
 * with the selection transformer. Wheel zooms to the cursor; holding Space
 * turns the stage into a pan surface. Palette drops are converted to native
 * coordinates and added at the cursor.
 */
export function CanvasStage() {
  const [containerRef, size] = useContainerSize<HTMLDivElement>();
  const stageOf = useRef<StageNode | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const didFit = useRef(false);

  const background = useEditorStore((s) => s.background);
  // Built from the document slices rather than selected: `boardStack` makes
  // fresh objects every call, and a selector whose result is never
  // reference-equal loops forever (`useSyncExternalStore` catches it, loudly).
  // Immer keeps untouched slices stable, so the memo recomputes exactly when
  // the stack can actually have changed.
  const objects = useEditorStore((s) => s.objects);
  const objectIds = useEditorStore((s) => s.objectIds);
  // The cast of the slide being edited. Objects are plan-level, but a slide
  // holds only the ones in its own scene — the others aren't drawn at all, so
  // there is nothing on the board that can't be clicked.
  const slideStates = useEditorStore(
    (s) => s.slides[s.currentSlideIndex]?.states,
  );
  const stack = useMemo(
    () =>
      boardStack({ objects, objectIds }).filter(
        (item) => slideStates?.[item.id] !== undefined,
      ),
    [objects, objectIds, slideStates],
  );
  // Read here rather than inside `SelectionTransformer`, so attaching the
  // handles happens in the same render that creates the nodes they attach to.
  // See the note on that component.
  const selectedIds = useEditorStore((s) => s.selectedIds);
  // A resize the transformer has no way of hearing about — read here for the
  // same reason the selection is, so the refresh lands after the nodes resize.
  const selectionSizes = useEditorStore(selectSelectionSizes);
  // Read here for the same reason: the transformer must not subscribe.
  const attackSelection = useEditorStore(selectSoleAttackId);
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
  // Placed through the shared hook, so a drop and a palette click refuse for the
  // same reason and say the same thing about it.
  const placeAttack = useAttackPlacement();
  const drawMove = useEditorStore((s) => s.drawMove);

  // Drawing a route is a *mode*: while it is on, a click means "corner here"
  // rather than "select that". Nothing else on the board listens (see the
  // `listening` group below), so the stage handlers below get every click.
  const drawing = useMoveDraft((s) => s.objectId !== null);
  useMoveDraftKeys();

  /**
   * The playhead is off zero, so the board is showing a *frame* of the slide
   * rather than the slide itself (plan §3.4). Every way of changing the document
   * from the canvas is off while it is: the tweened coordinates under the cursor
   * belong to an animation, and committing them as an object's layout would
   * rewrite the slide out of one of its own frames. The camera stays live —
   * zooming and panning look at the frame without touching the plan.
   */
  const locked = usePlayhead(selectPlaybackLocked);

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
  // Objects that follow the board keep following it while you
  // drag a token — which is the whole point of saying they follow it.
  useFollowing(stageOf);

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
    // A sweep during a draw would rubber-band the board instead of drawing.
    if (isPanning || drawing || locked) return;
    const stage = e.target.getStage();
    if (!stage || e.target !== stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    marqueeAdditive.current = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
    const start = screenToNative(pointer, view);
    updateMarquee({ start, current: start });
  };

  /** Where the pointer is, in the plan's own coordinates — snapped if snapping is on. */
  const nativePointer = (e: KonvaEventObject<MouseEvent>): Point | null => {
    const pointer = e.target.getStage()?.getPointerPosition();
    if (!pointer) return null;
    const at = screenToNative(pointer, view);
    const grid = snapEnabled ? gridSize : 0;
    return { x: snapValue(at.x, grid), y: snapValue(at.y, grid) };
  };

  const handleStageMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    if (drawing) {
      // The line from the last corner to the cursor is what makes this feel
      // like drawing rather than like entering coordinates.
      useMoveDraft.getState().setCursor(nativePointer(e));
      return;
    }
    if (!marqueeRef.current) return;
    const pointer = e.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    updateMarquee({
      start: marqueeRef.current.start,
      current: screenToNative(pointer, view),
    });
  };

  /** A click while drawing drops a corner; a double-click ends the route. */
  const handleStageClick = (e: KonvaEventObject<MouseEvent>) => {
    if (!drawing) return;
    const at = nativePointer(e);
    if (at) useMoveDraft.getState().addPoint(at);
  };

  /**
   * Double-click ends the route — but only a *real* double-click.
   *
   * Konva calls any two clicks inside its 400ms window a double-click, however
   * far apart they land, and clicking corners quickly is exactly what drawing a
   * route looks like. So the second click has to be on top of the first to
   * count: that is what someone means by double-clicking, and it leaves fast
   * corner-clicking alone.
   */
  const handleStageDblClick = (e: KonvaEventObject<MouseEvent>) => {
    if (!drawing) return;
    // Both of the double-click's clicks have already dropped a corner, so a
    // deliberate double-click shows up as the last *two* corners being in the
    // same place. Comparing the event's own position against the last corner
    // would compare it to the one its second click just added — always zero.
    const points = useMoveDraft.getState().points;
    const last = points.at(-1);
    const previous = points.at(-2);
    if (!last || !previous) return;
    // In screen pixels, so the tolerance doesn't change with the zoom level.
    const apart =
      Math.hypot(last.x - previous.x, last.y - previous.y) * view.scale;
    if (apart > DBLCLICK_SLOP_PX) return;

    e.evt.preventDefault();
    // Drop the duplicate the second click left behind, then end there.
    useMoveDraft.getState().undoPoint();
    finishMoveDraft(drawMove);
  };

  const finishMarquee = useCallback(() => {
    const sweep = marqueeRef.current;
    if (!sweep) return;
    if (useMoveDraft.getState().objectId !== null) return;
    updateMarquee(null);

    const rect = normalizeRect(sweep.start, sweep.current);
    // A press that never really moved is a plain click, not a sweep.
    const dragged =
      Math.max(rect.width, rect.height) * view.scale >= MARQUEE_THRESHOLD_PX;
    if (!dragged) {
      if (!marqueeAdditive.current) clearSelection();
      return;
    }

    const { objects, objectIds, selectedIds, slides, currentSlideIndex } =
      useEditorStore.getState();
    const ordered = objectIds
      .map((id) => objects[id])
      .filter((o): o is PlanObject => o !== undefined)
      // Sweep against where things are on *this* slide, which is the only place
      // the user can see them.
      .map((object) => ({
        object,
        state: resolveObjectState(object, slides, currentSlideIndex),
      }));
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
    if (!container || locked) return;
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

    // An attack resolves on the way in (plan §21): what lands is ordinary
    // objects and animations, not a thing the player has to learn about.
    const attackId = e.dataTransfer.getData(ATTACK_DATA_TYPE);
    if (attackId) return void placeAttack(attackId, at);
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
        ref={(node) => {
          stageOf.current = node;
          setStageNode(node);
        }}
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
        onClick={handleStageClick}
        onDblClick={handleStageDblClick}
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
          {/* Everything that can normally be clicked or dragged. While a route
              is being drawn — or the playhead is showing a frame — the whole
              group stops listening, so a click means "corner here" (or nothing)
              and can't accidentally grab a token instead. */}
          <Group listening={!drawing && !locked}>
            {stack.map((item) => (
              <ObjectNode
                key={item.id}
                objectId={item.id}
                draggable={!isPanning && !drawing && !locked}
              />
            ))}
            {/* Editing chrome describes the *stored* slide, so it would be
                lying about a board mid-animation. Hidden until the playhead is
                back at 0, which also stops the transformer from chasing nodes
                that GSAP is moving under it. */}
            {!locked && (
              <>
                <SelectionTransformer
                  selectedIds={selectedIds}
                  objectIds={objectIds}
                  selectionSizes={selectionSizes}
                  isAttack={attackSelection !== undefined}
                />
                <MotionPathLayer />
                <OriginHandle />
              </>
            )}
          </Group>
          <MoveDraftLayer />
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
