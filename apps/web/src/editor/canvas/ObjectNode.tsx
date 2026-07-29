import { memo, useEffect, useRef } from "react";
import { Group, Rect } from "react-konva";
import type { KonvaEventObject, Node as KonvaNode } from "konva/lib/Node";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "../../store/editorStore";
import { selectObjectState } from "../../store/selectors";
import { useIconSrc } from "../iconSrc";
import { MIN_OBJECT_SIZE, pivotCorrection } from "./coords";
import { claimDrag, releaseDrag } from "./dragGesture";
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
  // What to draw = base + the current slide's overrides (plan §5). `useShallow`
  // is required: the selector builds a fresh state object every call.
  const state = useEditorStore(
    useShallow((s) => selectObjectState(s, objectId)),
  );
  const isSelected = useEditorStore((s) => s.selectedIds.includes(objectId));
  /**
   * Is this object the *whole* selection? Turning about the object's own origin
   * is only meaningful then — see `pivotCorrection`, which is skipped otherwise
   * so several objects turn about the one point they share.
   */
  const turnsAlone = useEditorStore(
    (s) => s.selectedIds.length === 1 && s.selectedIds[0] === objectId,
  );
  const select = useEditorStore((s) => s.select);
  const selectOnly = useEditorStore((s) => s.selectOnly);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const moveObjects = useEditorStore((s) => s.moveObjects);
  const updateObject = useEditorStore((s) => s.updateObject);
  // Resolves bundled *and* synced WoW icons (plan §11.1) — a synced token
  // stores its stable id, and this re-renders once the palette or plan-load
  // registers its URL.
  const icon = useImageElement(useIconSrc(object?.iconId));

  const drag = useRef<{
    origin: { x: number; y: number };
    others: { node: KonvaNode; x: number; y: number }[];
  } | null>(null);

  // Going away mid-drag — deleted, or the slide changed under the pointer —
  // would otherwise leave the lead held by a node that can never release it,
  // and every later drag would find it taken and commit nothing.
  useEffect(() => () => releaseDrag(objectId), [objectId]);

  if (!object || !state) return null;
  // A tether has no transform of its own — it's drawn from its endpoints.
  if (object.type === "tether") return <TetherNode objectId={objectId} />;
  // Transforms come from the resolved slide state; tint/label are slide-independent.
  const { x, y, w, h, rotation, opacity } = state;
  const { tint, label } = object.base;
  const colour = tint ?? DEFAULT_TINT;

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
    // Alt reaches *into* a group and takes hold of the one object under the
    // cursor (plan §18.1). Alt rather than ctrl/cmd because those three are
    // already the additive modifier here, and a key can't mean two things; it
    // also matches the deep-select modifier design tools use. Unconditional —
    // an object already selected as part of its group is exactly the one an
    // alt-click is asking to narrow down to.
    if (e.evt.altKey) selectOnly([objectId]);
    else if (additive) toggleSelect(objectId);
    // Keep an existing multi-selection intact so it can be dragged as a group.
    else if (!isSelected) select([objectId]);
  };

  const handleDragStart = (e: KonvaEventObject<DragEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    // Only the node the pointer grabbed follows the gesture through; the rest
    // of the selection is dragged *by* it and has nothing of its own to say
    // (see `claimDrag`).
    if (!claimDrag(objectId)) return;
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
    releaseDrag(objectId);
    const state = drag.current;
    // Carried along by the node that *is* leading — it commits this object too.
    if (!state) return;
    const dx = e.target.x() - state.origin.x;
    const dy = e.target.y() - state.origin.y;
    // Everything that moved, in one action: dragging a group of three is one
    // thing the author did, and undoing it must not take three presses — nor
    // walk the group back apart, a member at a time, on the way.
    moveObjects([
      { id: objectId, x: e.target.x(), y: e.target.y() },
      ...state.others.map((other) => ({
        id: other.node.id(),
        x: other.x + dx,
        y: other.y + dy,
      })),
    ]);
    drag.current = null;
  };

  /**
   * Where the handle's work belongs in the document — see `pivotCorrection`,
   * which owns the rule. Applied during the gesture and not only on release, or
   * a lone shape would swing about its middle under the cursor and jump on
   * drop. It is measured from the *document's* transform each time rather than
   * the last frame's, so repeated events in one gesture settle on the same
   * answer instead of drifting.
   */
  const correction = (node: KonvaNode) =>
    pivotCorrection(
      { x, y, w, h, rotation, ox: object.base.ox, oy: object.base.oy },
      node,
      turnsAlone,
    );

  const handleTransform = (e: KonvaEventObject<Event>) => {
    const placed = correction(e.target);
    if (placed) e.target.position({ x: placed.x, y: placed.y });
  };

  /** Konva resizes by scaling; fold that scale back into w/h and reset it. */
  const handleTransformEnd = (e: KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    // Always reset the scale, committed here or not: the node's props say 1, so
    // React will never write it back, and a scale left on would compound into
    // the next gesture.
    node.scaleX(1);
    node.scaleY(1);
    // Several objects moving together are settled as **one** action by
    // `SelectionTransformer`, whose own `transformend` runs before this — this
    // object's new box is already in the document, and committing it again here
    // would only add an undo step per member.
    if (!turnsAlone) return;
    const placed = correction(node);
    updateObject(objectId, {
      x: placed?.x ?? node.x(),
      y: placed?.y ?? node.y(),
      w: Math.max(MIN_OBJECT_SIZE, w * scaleX),
      h: Math.max(MIN_OBJECT_SIZE, h * scaleY),
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
      // Konva by id, so an object that starts a slide invisible must already
      // be there for an entrance effect to reveal. Konva skips invisible nodes
      // when drawing and hit-testing, so this costs nothing on screen.
      visible={state.visible}
      draggable={draggable && !object.locked}
      // Selection is an *editor* concern. The viewer enables listening on slides
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
