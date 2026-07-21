import { Arrow, Circle, Group, Image as KonvaImage, Text } from "react-konva";
import {
  mechanicOps,
  type ObjectState,
  type ObjectStyle,
  type ObjectType,
  type PlanObject,
  type ShapeKind,
} from "@raidplan/shared";
import { useIconSrc } from "../iconSrc";
import { labelLayout, LABEL_COLOUR, LABEL_FONT_SIZE } from "./objectLabel";
import { MechArtwork } from "./MechArtwork";
import { useImageElement } from "./useImageElement";

/**
 * How a plan object *looks*, with no idea how it's edited.
 *
 * Split out of `ObjectNode` (which owns selection and dragging) so the same
 * drawing can render objects that aren't in the store at all — specifically the
 * **expanded objects of a placed attack** (plan §17), which are materialised
 * from an `AttackDef` at render time and deliberately never enter the document.
 * One definition of "what a soak looks like" for both.
 */
export const DEFAULT_TINT = "#4f9dff";

/**
 * A read-only object at a resolved state: positioned, non-interactive, and
 * carrying the object's id so the animation engine and the WebM exporter can
 * find and drive its node exactly like a real one.
 */
export function ObjectVisual({
  object,
  state,
}: {
  object: PlanObject;
  state: ObjectState;
}) {
  const icon = useImageElement(useIconSrc(object.iconId));

  // A tether derives its geometry from two *store* objects, so it has no
  // standalone visual to preview. Attack tethers show in the viewer/preview.
  if (object.type === "tether") return null;

  const { x, y, w, h, rotation, opacity } = state;
  const { tint, label } = object.base;

  return (
    <Group
      id={object.id}
      x={x}
      y={y}
      rotation={rotation}
      opacity={opacity}
      // Mounted even while hidden, so the exporter's GSAP pass can reveal it —
      // the same rule `ObjectNode` follows.
      visible={state.visible}
      listening={false}
    >
      <ObjectContent
        type={object.type}
        shape={object.shape}
        style={object.style}
        w={w}
        h={h}
        colour={tint ?? DEFAULT_TINT}
        tint={tint}
        label={label}
        icon={icon}
      />
    </Group>
  );
}

/** The visual for an object, chosen by its type (plan §2.4 primitives). */
export function ObjectContent({
  type,
  shape,
  style,
  w,
  h,
  colour,
  tint,
  label,
  icon,
}: {
  type: ObjectType;
  shape: ShapeKind | undefined;
  style: ObjectStyle | undefined;
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
        style={style}
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

/** The artwork for an object, chosen by its type (plan §2.4 primitives). */
function ObjectArtwork({
  type,
  shape,
  style,
  w,
  h,
  colour,
  tint,
  icon,
}: {
  type: ObjectType;
  shape: ShapeKind | undefined;
  style: ObjectStyle | undefined;
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
      // Every shape — generic rect/circle and the WoW mechanics — is drawn from
      // the shared draw-ops, so the editor matches the OG preview exactly.
      return (
        <MechArtwork
          ops={mechanicOps(shape ?? "rect", w, h, style)}
          tint={colour}
          w={w}
          h={h}
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
