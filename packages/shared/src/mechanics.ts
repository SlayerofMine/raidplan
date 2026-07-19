import { z } from "zod";
import type { ShapeKind } from "./effects.js";
import type { Point } from "./transform.js";

/**
 * The **visual language of mechanic shapes** (soaks, voidzones, frontals,
 * pickups, tethers), expressed once as renderer-agnostic draw-ops.
 *
 * Why here and not in the editor: the plan is drawn by *two* renderers — Konva
 * in the browser (`ObjectNode.tsx`) and a hand-written SVG string server-side
 * for Discord previews (`renderPlanSvg.ts`). Geometry computed inside a Konva
 * `sceneFunc` could never be reproduced in SVG, so it lives here instead as a
 * small list of primitives (ellipse / rect / path / polyline) that each renderer
 * interprets. Same discipline as `resolveObjectState`: the maths is shared, only
 * the drawing differs — so the board and its preview can't drift.
 *
 * A renderer is still free to *draw* this geometry imperatively — `TetherNode`
 * paints `tetherGeometry` in a `sceneFunc` so it can re-read its endpoints every
 * frame — but it must not invent geometry the other renderer can't reproduce.
 *
 * Shapes are laid out in the object's own box `(0,0)‥(w,h)`; colour is applied
 * by the renderer from the object's `tint`, so form (not colour) is what tells
 * a soak from a voidzone. Tethers are the exception — their ops are in absolute
 * stage space because they span two other objects.
 */

/** How a shape's interior is filled — resolved to a real colour by the renderer. */
export type MechFill = "none" | "soft" | "solid" | "hazard";
/** How a shape's outline is stroked. */
export type MechStroke = "none" | "solid" | "dashed";

/**
 * Per-object style customization (plan §2.4). All optional — an absent field
 * keeps the shape's built-in default, so old plans are unchanged. Composable
 * with `tint`: colour stays separate, this changes *form*.
 */
/** Interior treatment the user can pick for area shapes. */
export const MECH_FILL_STYLES = [
  "soft",
  "solid",
  "striped",
  "hazard",
  "none",
] as const;
export type MechFillStyle = (typeof MECH_FILL_STYLES)[number];
/** Silhouette for blob shapes (voidzone). */
export const MECH_EDGES = ["scalloped", "round"] as const;
/** Line style for tethers. */
export const MECH_LINES = ["squiggly", "straight"] as const;

export const ObjectStyleSchema = z.object({
  fill: z.enum(MECH_FILL_STYLES).optional(),
  outline: z.boolean().optional(),
  edge: z.enum(MECH_EDGES).optional(),
  line: z.enum(MECH_LINES).optional(),
});
export type ObjectStyle = z.infer<typeof ObjectStyleSchema>;

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

const STRIPE_STROKE = 2;
/**
 * Hatch spacing, as a fraction of the shape's smaller radius with a pixel
 * floor. Tight enough to read as a filled pattern rather than a few stray
 * lines, while the floor stops a small shape turning into a solid block.
 */
const STRIPE_GAP_RATIO = 0.16;
const STRIPE_MIN_GAP = 6;

/**
 * Diagonal hatch lines clipped to an ellipse — the "striped" fill. Each stripe
 * is a chord solved exactly against the ellipse (line ∩ ellipse), so the fill
 * stays inside the outline in both renderers with no clip-path support needed.
 */
function ellipseStripes(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): MechOp[] {
  const angle = -Math.PI / 4; // 45° diagonal
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const nx = -uy;
  const ny = ux;
  const spacing = Math.max(STRIPE_MIN_GAP, Math.min(rx, ry) * STRIPE_GAP_RATIO);
  const reach = Math.hypot(rx, ry);
  const a = (ux * ux) / (rx * rx) + (uy * uy) / (ry * ry);

  const ops: MechOp[] = [];
  for (let c = -reach; c <= reach; c += spacing) {
    const ox = c * nx;
    const oy = c * ny;
    const b = 2 * ((ox * ux) / (rx * rx) + (oy * uy) / (ry * ry));
    const cc = (ox * ox) / (rx * rx) + (oy * oy) / (ry * ry) - 1;
    const disc = b * b - 4 * a * cc;
    if (disc <= 0) continue;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    ops.push({
      t: "polyline",
      points: [
        round(cx + ox + t1 * ux),
        round(cy + oy + t1 * uy),
        round(cx + ox + t2 * ux),
        round(cy + oy + t2 * uy),
      ],
      closed: false,
      fill: "none",
      stroke: "solid",
      strokeWidth: STRIPE_STROKE,
    });
  }
  return ops;
}

/**
 * Apply per-object {@link ObjectStyle} to a shape's ops. The `fill`/`outline`
 * choices act on the shape's *primary* op (its silhouette, always `ops[0]`);
 * `striped` keeps a translucent `soft` wash under the hatch lines, which are
 * clipped to the given ellipse and drawn behind the marks. `edge`/`line` change
 * geometry and are handled by the builders, not here.
 */
function applyStyle(
  ops: MechOp[],
  style: ObjectStyle | undefined,
  clip: { cx: number; cy: number; rx: number; ry: number },
): MechOp[] {
  const primary = ops[0];
  if (!style || !primary) return ops;

  if (style.outline === false) primary.stroke = "none";

  if (!style.fill) return ops;
  if (style.fill === "striped") {
    // A wash under the hatch, so the shape still reads as a filled area.
    primary.fill = "soft";
    if (primary.stroke === "none" && style.outline !== false) {
      primary.stroke = "solid";
    }
    return [
      primary,
      ...ellipseStripes(clip.cx, clip.cy, clip.rx, clip.ry),
      ...ops.slice(1),
    ];
  }
  primary.fill = style.fill;
  return ops;
}

/**
 * The draw-ops for a mechanic (or generic) shape, in the object's local box.
 * Drawn in order, so fills come before the marks that sit on top. `style`
 * customizes fill/outline/edge without changing what the shape *means*.
 */
export function mechanicOps(
  shape: ShapeKind,
  w: number,
  h: number,
  style?: ObjectStyle,
): MechOp[] {
  const cx = w / 2;
  const cy = h / 2;
  // The ellipse the "striped" fill is clipped to — the shape's round extent.
  let clip = { cx, cy, rx: w / 2, ry: h / 2 };
  let ops: MechOp[];

  switch (shape) {
    case "rect":
      ops = [
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
      break;

    case "circle":
      ops = [
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
      break;

    case "cone": {
      // Frontal: a wedge with chevrons marching from the apex toward the edge.
      ops = [
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
      break;
    }

    case "line": {
      // Beam/frontal: a bar with chevrons pointing along its length (+x).
      ops = [
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
      break;
    }

    case "soak": {
      // Stack-here target: concentric rings + chevrons pointing *inward*.
      ops = [
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
      break;
    }

    case "voidzone": {
      // Hazard puddle: a bubbly (or, if `edge:"round"`, clean) silhouette with a
      // radial "danger" fill. Striped forces a round outline so the hatch reads.
      const rx = w * 0.46;
      const ry = h * 0.46;
      clip = { cx, cy, rx, ry };
      const rounded = style?.edge === "round" || style?.fill === "striped";
      const silhouette: MechOp = rounded
        ? {
            t: "ellipse",
            cx,
            cy,
            rx,
            ry,
            fill: "hazard",
            stroke: "solid",
            strokeWidth: STROKE,
          }
        : {
            t: "path",
            d: scallopedPath(cx, cy, rx, ry, 8, 0.12),
            fill: "hazard",
            stroke: "solid",
            strokeWidth: STROKE,
          };
      ops = [
        silhouette,
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
      break;
    }

    case "pickup":
      // Collectible: a four-point sparkle with a bright centre.
      ops = [
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
      break;

    default:
      ops = [
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

  return applyStyle(ops, style, clip);
}

/** How far a tether wobbles off the straight line, and its bead radius. */
const TETHER_AMP = 8;
const TETHER_STROKE = 4;
const TETHER_ANCHOR = 5;

/** A tether's raw geometry: a polyline plus the two anchor beads. */
export interface TetherGeometry {
  /** Flat `[x0,y0,x1,y1,…]` polyline for the connecting line. */
  points: number[];
  anchors: { x: number; y: number; r: number }[];
  strokeWidth: number;
}

/**
 * The raw geometry of a tether between two world-space points (object centres).
 * Squiggly by default (reads as "link/pull", distinct from the straight arrow);
 * `style.line === "straight"` draws a plain line instead.
 *
 * This is the primitive: {@link tetherOps} turns it into draw-ops for the SVG
 * preview, while the editor's `TetherNode` draws these points straight onto the
 * canvas each frame from its endpoints' *live* positions.
 */
export function tetherGeometry(
  from: Point,
  to: Point,
  style?: ObjectStyle,
): TetherGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular, for the lateral wobble.
  const px = -uy;
  const py = ux;

  const points: number[] = [];
  if (style?.line === "straight") {
    points.push(round(from.x), round(from.y), round(to.x), round(to.y));
  } else {
    const waves = Math.max(1, Math.round(len / 60));
    const samples = Math.max(12, waves * 8);
    for (let i = 0; i <= samples; i++) {
      const s = i / samples;
      const along = s * len;
      const off = TETHER_AMP * Math.sin(s * waves * Math.PI * 2);
      points.push(
        round(from.x + ux * along + px * off),
        round(from.y + uy * along + py * off),
      );
    }
  }

  return {
    points,
    anchors: [
      { x: round(from.x), y: round(from.y), r: TETHER_ANCHOR },
      { x: round(to.x), y: round(to.y), r: TETHER_ANCHOR },
    ],
    strokeWidth: TETHER_STROKE,
  };
}

/**
 * The draw-ops for a tether — {@link tetherGeometry} expressed as a path plus
 * anchor ellipses, for the server-side SVG preview. Points are absolute, so the
 * renderer draws these with no per-object transform.
 */
export function tetherOps(
  from: Point,
  to: Point,
  style?: ObjectStyle,
): MechOp[] {
  const geometry = tetherGeometry(from, to, style);
  const { points, anchors } = geometry;

  let d = "";
  for (let i = 0; i < points.length; i += 2) {
    d += `${i === 0 ? "M" : "L"}${points[i]} ${points[i + 1]}`;
  }

  return [
    {
      t: "path",
      d,
      fill: "none",
      stroke: "solid",
      strokeWidth: geometry.strokeWidth,
    },
    ...anchors.map((a): MechOp => ({
      t: "ellipse",
      cx: a.x,
      cy: a.y,
      rx: a.r,
      ry: a.r,
      fill: "soft",
      stroke: "solid",
      strokeWidth: 2,
    })),
  ];
}
