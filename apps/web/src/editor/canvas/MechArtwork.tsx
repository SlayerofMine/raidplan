import { Ellipse, Line, Path, Rect } from "react-konva";
import type { MechFill, MechOp, MechStroke } from "@raidplan/shared";

/**
 * The Konva half of the mechanic visual language: render a list of shared
 * {@link MechOp} draw-ops (from `mechanics.ts`) as react-konva nodes. The SVG
 * half lives in the API's `renderPlanSvg`; both read the *same* ops, so the
 * board and its Discord preview can't drift.
 *
 * Colour is applied here from the object's `tint`: `soft` → a translucent fill,
 * `hazard` → a radial "danger" gradient centred on the box, `dashed` → a dashed
 * stroke. Form comes from the ops; only the colour is per-object.
 */

/** Translucent fill alpha for `soft` (matches the historic shape fill). */
const SOFT_ALPHA = "33";
/** Stronger alpha for `solid` — reads as filled but still lets the map show. */
const SOLID_ALPHA = "cc";

function strokeProps(stroke: MechStroke, tint: string, width: number) {
  if (stroke === "none") return {};
  return {
    stroke: tint,
    strokeWidth: width,
    ...(stroke === "dashed" ? { dash: [8, 6] } : {}),
  };
}

function fillProps(
  fill: MechFill,
  tint: string,
  hazard: { cx: number; cy: number; r: number },
) {
  if (fill === "none") return {};
  if (fill === "soft") return { fill: `${tint}${SOFT_ALPHA}` };
  if (fill === "solid") return { fill: `${tint}${SOLID_ALPHA}` };
  // hazard — opaque-ish centre fading out, so a voidzone reads as "avoid".
  return {
    fillRadialGradientStartPoint: { x: hazard.cx, y: hazard.cy },
    fillRadialGradientStartRadius: 0,
    fillRadialGradientEndPoint: { x: hazard.cx, y: hazard.cy },
    fillRadialGradientEndRadius: hazard.r,
    fillRadialGradientColorStops: [0, `${tint}88`, 1, `${tint}11`],
  };
}

export function MechArtwork({
  ops,
  tint,
  w,
  h,
  hitStrokeWidth,
}: {
  ops: MechOp[];
  tint: string;
  /** Box size — only used to place the `hazard` radial gradient. */
  w: number;
  h: number;
  /** Widen the hit area for thin shapes (tethers), so they're easy to click. */
  hitStrokeWidth?: number;
}) {
  const hazard = { cx: w / 2, cy: h / 2, r: Math.max(w, h) / 2 || 1 };

  return (
    <>
      {ops.map((op, i) => {
        const style = {
          ...fillProps(op.fill, tint, hazard),
          ...strokeProps(op.stroke, tint, op.strokeWidth),
          ...(hitStrokeWidth !== undefined ? { hitStrokeWidth } : {}),
        };
        switch (op.t) {
          case "ellipse":
            return (
              <Ellipse
                key={i}
                x={op.cx}
                y={op.cy}
                radiusX={op.rx}
                radiusY={op.ry}
                {...style}
              />
            );
          case "rect":
            return (
              <Rect
                key={i}
                x={op.x}
                y={op.y}
                width={op.w}
                height={op.h}
                {...style}
              />
            );
          case "path":
            return <Path key={i} data={op.d} {...style} />;
          case "polyline":
            return (
              <Line key={i} points={op.points} closed={op.closed} {...style} />
            );
        }
      })}
    </>
  );
}
