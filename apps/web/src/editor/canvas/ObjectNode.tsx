import { memo, useRef } from "react";
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Rect,
  Text,
  Wedge,
} from "react-konva";
import type { KonvaEventObject, Node as KonvaNode } from "konva/lib/Node";
import type { ObjectType, ShapeKind } from "@raidplan/shared";
import { getIconById } from "../../assets/icons";
import { useEditorStore } from "../../store/editorStore";
import { labelLayout, LABEL_COLOUR, LABEL_FONT_SIZE } from "./objectLabel";
import { useImageElement } from "./useImageElement";

const DEFAULT_TINT = "#4f9dff";
/** Shapes get a translucent fill of their own tint. */
const FILL_ALPHA = "33";

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
  const isSelected = useEditorStore((s) => s.selectedIds.includes(objectId));
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const moveObject = useEditorStore((s) => s.moveObject);
  const updateObject = useEditorStore((s) => s.updateObject);
  const icon = useImageElement(
    object?.iconId ? getIconById(object.iconId)?.src : undefined,
  );

  const drag = useRef<{
    origin: { x: number; y: number };
    others: { node: KonvaNode; x: number; y: number }[];
  } | null>(null);

  if (!object || !object.base.visible) return null;
  const { x, y, w, h, rotation, opacity, tint, label } = object.base;
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

  /** Konva resizes by scaling; fold that scale back into w/h and reset it. */
  const handleTransformEnd = (e: KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    updateObject(objectId, {
      x: node.x(),
      y: node.y(),
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
      draggable={draggable && !object.locked}
      onMouseDown={handleMouseDown}
      onTap={() => select([objectId])}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
    >
      <ObjectContent
        type={object.type}
        shape={object.shape}
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

/** The visual for an object, chosen by its type (plan §2.4 primitives). */
function ObjectContent({
  type,
  shape,
  w,
  h,
  colour,
  tint,
  label,
  icon,
}: {
  type: ObjectType;
  shape: ShapeKind | undefined;
  w: number;
  h: number;
  /** Tint with a fallback applied — safe to use as a stroke/fill. */
  colour: string;
  /** The raw tint: only class/role tokens set one, and only they get a ring. */
  tint: string | undefined;
  label: string | undefined;
  icon: HTMLImageElement | undefined;
}) {
  // A text object *is* its label, so it renders the label as its content and
  // gets no separate one; every other type draws its artwork then the label.
  if (type === "text") {
    return (
      <Text
        text={label ?? "Text"}
        width={w}
        height={h}
        fontSize={Math.max(10, h * 0.6)}
        fontStyle="bold"
        fill={colour}
        align="center"
        verticalAlign="middle"
      />
    );
  }

  return (
    <>
      <ObjectArtwork
        type={type}
        shape={shape}
        w={w}
        h={h}
        colour={colour}
        tint={tint}
        icon={icon}
      />
      <ObjectLabel type={type} label={label} w={w} h={h} />
    </>
  );
}

/** The object's label, placed per its type (plan §5 — every object may have one). */
function ObjectLabel({
  type,
  label,
  w,
  h,
}: {
  type: ObjectType;
  label: string | undefined;
  w: number;
  h: number;
}) {
  const layout = labelLayout(type, h);
  if (!label || !layout) return null;
  return (
    <Text
      text={label}
      x={0}
      y={layout.y}
      width={w}
      height={layout.height}
      align="center"
      verticalAlign={layout.verticalAlign}
      fontSize={LABEL_FONT_SIZE}
      fill={LABEL_COLOUR}
      listening={false}
    />
  );
}

/** The visual for an object, chosen by its type (plan §2.4 primitives). */
function ObjectArtwork({
  type,
  shape,
  w,
  h,
  colour,
  tint,
  icon,
}: {
  type: ObjectType;
  shape: ShapeKind | undefined;
  w: number;
  h: number;
  colour: string;
  tint: string | undefined;
  icon: HTMLImageElement | undefined;
}) {
  switch (type) {
    case "arrow":
      return (
        <Arrow
          points={[0, h / 2, w, h / 2]}
          stroke={colour}
          fill={colour}
          strokeWidth={6}
          pointerLength={16}
          pointerWidth={16}
          hitStrokeWidth={20}
        />
      );

    case "shape":
      if (shape === "circle") {
        return (
          <Ellipse
            x={w / 2}
            y={h / 2}
            radiusX={w / 2}
            radiusY={h / 2}
            stroke={colour}
            strokeWidth={3}
            fill={`${colour}${FILL_ALPHA}`}
          />
        );
      }
      if (shape === "cone") {
        // A 60° wedge opening upward from the box's bottom-centre.
        return (
          <Wedge
            x={w / 2}
            y={h}
            radius={h}
            angle={60}
            rotation={-120}
            stroke={colour}
            strokeWidth={3}
            fill={`${colour}${FILL_ALPHA}`}
          />
        );
      }
      return (
        <Rect
          width={w}
          height={h}
          stroke={colour}
          strokeWidth={3}
          fill={`${colour}${FILL_ALPHA}`}
        />
      );

    // token / marker / image
    default:
      return (
        <>
          <KonvaImage image={icon} width={w} height={h} />
          {/* Class/role colour ring around the token (plan §2.5). */}
          {tint && (
            <Circle
              x={w / 2}
              y={h / 2}
              radius={Math.min(w, h) / 2 - 2}
              stroke={tint}
              strokeWidth={4}
              listening={false}
            />
          )}
        </>
      );
  }
}
