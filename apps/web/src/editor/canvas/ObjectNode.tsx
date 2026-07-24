import { memo, useRef } from "react";
import { Group, Rect } from "react-konva";
import type { KonvaEventObject, Node as KonvaNode } from "konva/lib/Node";
import { useShallow } from "zustand/react/shallow";
import { rotateAboutPivot } from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { selectObjectState } from "../../store/selectors";
import { useIconSrc } from "../iconSrc";
import { DEFAULT_TINT, ObjectContent } from "./ObjectVisual";
import { TetherNode } from "./TetherNode";
import { useImageElement } from "./useImageElement";

/**
 * One plan object → one Konva node (plan §6). Subscribes to just its own slice
 * of the store so dragging one token never re-renders the other 49 (plan §8.2).
 *
 * The node is a `Group` at the object's native `(x, y)` carrying `id` so the
 * selection `Transformer` can find it. Multi-object drags are applied to the
 * other selected nodes **imperatively** during the drag (no React per frame,
 * plan §8.1) and committed to the store on drop.
 */
export const ObjectNode = memo(function ObjectNode({
  objectId,
  draggable,
}: {
  objectId: string;
  draggable: boolean;
}) {
  const object = useEditorStore((s) => s.objects[objectId]);
  // What to draw = base + the current step's overrides (plan §5). `useShallow`
  // is required: the selector builds a fresh state object every call.
  const state = useEditorStore(
    useShallow((s) => selectObjectState(s, objectId)),
  );
  const isSelected = useEditorStore((s) => s.selectedIds.includes(objectId));
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const moveObject = useEditorStore((s) => s.moveObject);
  const updateObject = useEditorStore((s) => s.updateObject);
  // Resolves bundled *and* synced WoW icons (plan §11.1) — a synced token
  // stores its stable id, and this re-renders once the palette or plan-load
  // registers its URL.
  const icon = useImageElement(useIconSrc(object?.iconId));

  const drag = useRef<{
    origin: { x: number; y: number };
    others: { node: KonvaNode; x: number; y: number }[];
  } | null>(null);

  if (!object || !state) return null;
  // A tether has no transform of its own — it's drawn from its endpoints.
  if (object.type === "tether") return <TetherNode objectId={objectId} />;
  // Transforms come from the resolved step state; tint/label are step-independent.
  const { x, y, w, h, rotation, opacity } = state;
  const { tint, label } = object.base;
  const colour = tint ?? DEFAULT_TINT;

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
    if (additive) toggleSelect(objectId);
    // Keep an existing multi-selection intact so it can be dragged as a group.
    else if (!isSelected) select([objectId]);
  };

  const handleDragStart = (e: KonvaEventObject<DragEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const others = useEditorStore
      .getState()
      .selectedIds.filter((id) => id !== objectId)
      .map((id) => stage.findOne(`#${id}`))
      .filter((node): node is KonvaNode => node !== undefined)
      .map((node) => ({ node, x: node.x(), y: node.y() }));
    drag.current = { origin: { x: e.target.x(), y: e.target.y() }, others };
  };

  const handleDragMove = (e: KonvaEventObject<DragEvent>) => {
    const state = drag.current;
    if (!state) return;
    const dx = e.target.x() - state.origin.x;
    const dy = e.target.y() - state.origin.y;
    for (const other of state.others) {
      other.node.position({ x: other.x + dx, y: other.y + dy });
    }
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const state = drag.current;
    const dx = state ? e.target.x() - state.origin.x : 0;
    const dy = state ? e.target.y() - state.origin.y : 0;
    moveObject(objectId, e.target.x(), e.target.y());
    for (const other of state?.others ?? []) {
      moveObject(other.node.id(), other.x + dx, other.y + dy);
    }
    drag.current = null;
  };

  /**
   * Konva's Transformer always turns the selection about its bounding box's
   * centre, and offers no way to move that. So the object turns about its own
   * **origin** by correction: whatever rotation the handle produced is kept, and
   * `x/y` are re-derived so the origin is the point that didn't move (§18.17).
   *
   * Applied during the gesture, not just on release, or the shape would swing
   * about its middle under the cursor and jump on drop. It is measured from the
   * *document's* transform each time rather than the last frame's, so repeated
   * events in one gesture settle on the same answer instead of drifting.
   *
   * A resize is left alone — `x/y` then belong to the handle being dragged, and
   * there is no rotation delta to correct anyway.
   */
  const pivotCorrection = (node: KonvaNode) => {
    if (node.rotation() === rotation) return null;
    return rotateAboutPivot(
      { x, y, w, h, rotation, ox: object.base.ox, oy: object.base.oy },
      node.rotation() - rotation,
    );
  };

  const handleTransform = (e: KonvaEventObject<Event>) => {
    const placed = pivotCorrection(e.target);
    if (placed) e.target.position({ x: placed.x, y: placed.y });
  };

  /** Konva resizes by scaling; fold that scale back into w/h and reset it. */
  const handleTransformEnd = (e: KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    const placed = pivotCorrection(node);
    updateObject(objectId, {
      x: placed?.x ?? node.x(),
      y: placed?.y ?? node.y(),
      w: Math.max(8, w * scaleX),
      h: Math.max(8, h * scaleY),
      rotation: node.rotation(),
    });
  };

  return (
    <Group
      id={objectId}
      x={x}
      y={y}
      rotation={rotation}
      opacity={opacity}
      // What size this node is drawn at, so a size animation can scale it —
      // React isn't in the frame loop, so nothing else can resize it (§8.1).
      baseW={w}
      baseH={h}
      scaleX={1}
      scaleY={1}
      // Hidden objects keep their node rather than unmounting: playback drives
      // Konva by id, so an object that starts a step invisible — every attack
      // part does (plan §17) — must already be there for an entrance effect to
      // reveal. Konva skips invisible nodes when drawing and hit-testing, so
      // this costs nothing on screen.
      visible={state.visible}
      draggable={draggable && !object.locked}
      // Selection is an *editor* concern. The viewer enables listening on steps
      // with onClick animations, and must not mutate the editor's selection.
      onMouseDown={draggable ? handleMouseDown : undefined}
      onTap={draggable ? () => select([objectId]) : undefined}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onTransform={handleTransform}
      onTransformEnd={handleTransformEnd}
    >
      <ObjectContent
        type={object.type}
        shape={object.shape}
        style={object.style}
        w={w}
        h={h}
        colour={colour}
        tint={tint}
        label={label}
        icon={icon}
      />
      {isSelected && object.locked && (
        <Rect
          width={w}
          height={h}
          stroke="#f2c744"
          strokeWidth={2}
          dash={[6, 4]}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </Group>
  );
});
