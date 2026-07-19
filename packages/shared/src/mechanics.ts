import type { ShapeKind } from "./effects.js";
import type { Point } from "./transform.js";

/**
 * The **visual language of mechanic shapes** (soaks, voidzones, frontals,
 * pickups, tethers), expressed once as renderer-agnostic draw-ops.
 *
 * Why here and not in the editor: the plan is drawn by *two* renderers — Konva
 * in the browser (`ObjectNode.tsx`) and a hand-written SVG string server-side
 * for Discord previews (`renderPlanSvg.ts`). A Konva-only `sceneFunc` couldn't
 * be reproduced in SVG, so the geometry lives here as a small list of
 * primitives (ellipse / rect / path / polyline) that each renderer interprets.
 * Same discipline as `resolveObjectState`: the maths is shared, only the
 * drawing differs — so the board and its preview can't drift.
 *
 * Shapes are laid out in the object's own box `(0,0)‥(w,h)`; colour is applied
 * by the renderer from the object's `tint`, so form (not colour) is what tells
 * a soak from a voidzone. Tethers are the exception — their ops are in absolute
 * stage space because they span two other objects.
 */

/** How a shape's interior is filled — resolved to a real colour by the renderer. */
export type MechFill = "none" | "soft" | "hazard";
/** How a shape's outline is stroked. */
export type MechStroke = "none" | "solid" | "dashed";

interface OpStyle {
  fill: MechFill;
  stroke: MechStroke;
  strokeWidth: number;
}

/** One primitive drawing instruction. Both renderers map these 1:1. */
export type MechOp =
  | (OpStyle & { t: "ellipse"; cx: number; cy: number; rx: number; ry: number })
  | (OpStyle & { t: "rect"; x: number; y: number; w: number; h: number })
  | (OpStyle & { t: "path"; d: string })
  | (OpStyle & { t: "polyline"; points: number[]; closed: boolean });

const STROKE = 3;
const MARK = 2.5;

/** An arrowhead/chevron pointing along `(dirX,dirY)` with its tip at `(tx,ty)`. */
function chevron(
  tx: number,
  ty: number,
  dirX: number,
  dirY: number,
  len: number,
  width: number,
): number[] {
  const bx = tx - dirX * len;
  const by = ty - dirY * len;
  // Perpendicular to the direction.
  const px = -dirY;
  const py = dirX;
  return [
    bx + px * width,
    by + py * width,
    tx,
    ty,
    bx - px * width,
    by - py * width,
  ];
}

/** A star/sparkle: `points` spikes alternating outer/inner radius about a centre. */
function starPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  points: number,
  innerRatio: number,
): number[] {
  const out: number[] = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : innerRatio;
    const a = -Math.PI / 2 + i * step;
    out.push(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r);
  }
  return out;
}

/** A closed "puddle" outline: an ellipse whose radius wobbles `bumps` times. */
function scallopedPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  bumps: number,
  amp: number,
): string {
  const samples = Math.max(24, bumps * 6);
  let d = "";
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const wobble = 1 + amp * Math.sin(bumps * a);
    const x = cx + Math.cos(a) * rx * wobble;
    const y = cy + Math.sin(a) * ry * wobble;
    d += `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`;
  }
  return `${d}Z`;
}

/** A 60° wedge opening away from an apex at the box's bottom-centre. */
function wedgePath(w: number, h: number): string {
  const half = (60 * Math.PI) / 180 / 2;
  const cx = w / 2;
  const left = cx - Math.sin(half) * h;
  const right = cx + Math.sin(half) * h;
  const tipY = h - Math.cos(half) * h;
  // Curved far edge (arc of radius h centred on the apex), as Konva's Wedge draws.
  return `M${round(cx)} ${round(h)}L${round(left)} ${round(tipY)}A${round(h)} ${round(h)} 0 0 1 ${round(right)} ${round(tipY)}Z`;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The draw-ops for a mechanic (or generic) shape, in the object's local box.
 * Drawn in order, so fills come before the marks that sit on top.
 */
export function mechanicOps(shape: ShapeKind, w: number, h: number): MechOp[] {
  const cx = w / 2;
  const cy = h / 2;

  switch (shape) {
    case "rect":
      return [
        {
          t: "rect",
          x: 0,
          y: 0,
          w,
          h,
          fill: "soft",
          stroke: "solid",
          strokeWidth: STROKE,
        },
      ];

    case "circle":
      return [
        {
          t: "ellipse",
          cx,
          cy,
          rx: w / 2,
          ry: h / 2,
          fill: "soft",
          stroke: "solid",
          strokeWidth: STROKE,
        },
      ];

    case "cone": {
      // Frontal: a wedge with chevrons marching from the apex toward the edge.
      const ops: MechOp[] = [
        {
          t: "path",
          d: wedgePath(w, h),
          fill: "soft",
          stroke: "solid",
          strokeWidth: STROKE,
        },
      ];
      for (const t of [0.45, 0.7]) {
        const y = h * (1 - t); // apex at y=h, far tip at y=0
        ops.push({
          t: "polyline",
          points: chevron(cx, y, 0, -1, h * 0.1, w * 0.12),
          closed: false,
          fill: "none",
          stroke: "solid",
          strokeWidth: MARK,
        });
      }
      return ops;
    }

    case "line": {
      // Beam/frontal: a bar with chevrons pointing along its length (+x).
      const ops: MechOp[] = [
        {
          t: "rect",
          x: 0,
          y: 0,
          w,
          h,
          fill: "soft",
          stroke: "solid",
          strokeWidth: STROKE,
        },
      ];
      for (const t of [0.3, 0.5, 0.7]) {
        ops.push({
          t: "polyline",
          points: chevron(w * t + h * 0.25, cy, 1, 0, h * 0.35, h * 0.28),
          closed: false,
          fill: "none",
          stroke: "solid",
          strokeWidth: MARK,
        });
      }
      return ops;
    }

    case "soak": {
      // Stack-here target: concentric rings + chevrons pointing *inward*.
      const ops: MechOp[] = [
        {
          t: "ellipse",
          cx,
          cy,
          rx: w / 2,
          ry: h / 2,
          fill: "none",
          stroke: "dashed",
          strokeWidth: STROKE,
        },
        {
          t: "ellipse",
          cx,
          cy,
          rx: w * 0.28,
          ry: h * 0.28,
          fill: "soft",
          stroke: "solid",
          strokeWidth: STROKE,
        },
      ];
      const rx = w * 0.42;
      const ry = h * 0.42;
      const len = Math.min(w, h) * 0.16;
      const wid = Math.min(w, h) * 0.12;
      // N/E/S/W tips, each pointing back toward the centre.
      const dirs: [number, number, number, number][] = [
        [cx, cy - ry, 0, 1],
        [cx + rx, cy, -1, 0],
        [cx, cy + ry, 0, -1],
        [cx - rx, cy, 1, 0],
      ];
      for (const [tx, ty, dx, dy] of dirs) {
        ops.push({
          t: "polyline",
          points: chevron(tx, ty, dx, dy, len, wid),
          closed: false,
          fill: "none",
          stroke: "solid",
          strokeWidth: MARK,
        });
      }
      return ops;
    }

    case "voidzone": {
      // Hazard puddle: a bubbly silhouette with a radial "danger" fill.
      return [
        {
          t: "path",
          d: scallopedPath(cx, cy, w * 0.46, h * 0.46, 8, 0.12),
          fill: "hazard",
          stroke: "solid",
          strokeWidth: STROKE,
        },
        {
          t: "ellipse",
          cx: cx - w * 0.14,
          cy: cy - h * 0.1,
          rx: w * 0.07,
          ry: h * 0.07,
          fill: "soft",
          stroke: "none",
          strokeWidth: 0,
        },
        {
          t: "ellipse",
          cx: cx + w * 0.16,
          cy: cy + h * 0.12,
          rx: w * 0.05,
          ry: h * 0.05,
          fill: "soft",
          stroke: "none",
          strokeWidth: 0,
        },
      ];
    }

    case "pickup":
      // Collectible: a four-point sparkle with a bright centre.
      return [
        {
          t: "polyline",
          points: starPoints(cx, cy, w / 2, h / 2, 4, 0.4),
          closed: true,
          fill: "soft",
          stroke: "solid",
          strokeWidth: STROKE,
        },
        {
          t: "ellipse",
          cx,
          cy,
          rx: w * 0.1,
          ry: h * 0.1,
          fill: "soft",
          stroke: "solid",
          strokeWidth: MARK,
        },
      ];

    default:
      return [
        {
          t: "rect",
          x: 0,
          y: 0,
          w,
          h,
          fill: "soft",
          stroke: "solid",
          strokeWidth: STROKE,
        },
      ];
  }
}

/** How far a tether wobbles off the straight line, and its bead radius. */
const TETHER_AMP = 8;
const TETHER_STROKE = 4;
const TETHER_ANCHOR = 5;

/**
 * The draw-ops for a tether between two world-space points (object centres).
 * A wavy line reads as a "link/pull" and is distinct from the straight arrow;
 * anchor dots mark the two ends. Points are absolute, so the renderer draws
 * these with no per-object transform.
 */
export function tetherOps(from: Point, to: Point): MechOp[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular, for the lateral wobble.
  const px = -uy;
  const py = ux;
  const waves = Math.max(1, Math.round(len / 60));
  const samples = Math.max(12, waves * 8);

  let d = "";
  for (let i = 0; i <= samples; i++) {
    const s = i / samples;
    const along = s * len;
    const off = TETHER_AMP * Math.sin(s * waves * Math.PI * 2);
    const x = from.x + ux * along + px * off;
    const y = from.y + uy * along + py * off;
    d += `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`;
  }

  return [
    { t: "path", d, fill: "none", stroke: "solid", strokeWidth: TETHER_STROKE },
    {
      t: "ellipse",
      cx: from.x,
      cy: from.y,
      rx: TETHER_ANCHOR,
      ry: TETHER_ANCHOR,
      fill: "soft",
      stroke: "solid",
      strokeWidth: 2,
    },
    {
      t: "ellipse",
      cx: to.x,
      cy: to.y,
      rx: TETHER_ANCHOR,
      ry: TETHER_ANCHOR,
      fill: "soft",
      stroke: "solid",
      strokeWidth: 2,
    },
  ];
}
