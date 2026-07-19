import { Shape } from "react-konva";
import type { Context } from "konva/lib/Context";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Shape as ShapeNode } from "konva/lib/Shape";
import { useShallow } from "zustand/react/shallow";
import { tetherGeometry, type ObjectStyle } from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { selectObjectState } from "../../store/selectors";
import { TETHER_DEFAULT_TINT } from "../../store/objectFactory";

/**
 * A tether (plan §2.4): a line between two *other* objects. It has no transform
 * of its own — its geometry is derived from its endpoints.
 *
 * **It reads its endpoints' live Konva positions on every draw**, rather than
 * from React state. That single decision is what makes it follow *per frame*:
 * during playback GSAP writes straight to the endpoint nodes and calls
 * `batchDraw()` each tick (plan §8.1 — React is never in the frame loop), and
 * this `sceneFunc` re-runs with it. The same holds mid-drag in the editor, so
 * the line tracks a token continuously instead of snapping on drop.
 *
 * The geometry itself still comes from the shared `tetherGeometry`, so the
 * canvas and the server-side SVG preview can't drift.
 */

/** Selection glow drawn behind the line. */
const GLOW_COLOUR = "rgba(79, 157, 255, 0.4)";
const GLOW_EXTRA = 6;
/** Generous grab width — a thin squiggle is otherwise painful to click. */
const HIT_WIDTH = 16;

/**
 * The centre of an endpoint, in the layer's (native) coordinate space, read
 * from the live Konva node. `getClientRect` accounts for the node's children
 * and current transform, so this stays correct while the object is animating.
 */
function endpointCentre(
  shape: ShapeNode,
  objectId: string,
): { x: number; y: number } | null {
  const layer = shape.getLayer();
  const node = layer?.findOne(`#${objectId}`);
  if (!layer || !node) return null;
  const box = node.getClientRect({ relativeTo: layer });
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function geometryFor(
  shape: ShapeNode,
  fromId: string,
  toId: string,
  style: ObjectStyle | undefined,
) {
  const from = endpointCentre(shape, fromId);
  const to = endpointCentre(shape, toId);
  if (!from || !to) return null;
  return tetherGeometry(from, to, style);
}

/** Trace a flat `[x0,y0,x1,y1,…]` polyline into the current path. */
function tracePolyline(ctx: Context, points: number[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0]!, points[1]!);
  for (let i = 2; i < points.length; i += 2) {
    ctx.lineTo(points[i]!, points[i + 1]!);
  }
}

export function TetherNode({ objectId }: { objectId: string }) {
  const object = useEditorStore((s) => s.objects[objectId]);
  const self = useEditorStore(
    useShallow((s) => selectObjectState(s, objectId)),
  );
  const isSelected = useEditorStore((s) => s.selectedIds.includes(objectId));
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);

  if (!object || !self || !self.visible) return null;
  const { fromId, toId } = object;
  if (!fromId || !toId) return null;

  const tint = object.base.tint ?? TETHER_DEFAULT_TINT;
  const style = object.style;

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
    if (additive) toggleSelect(objectId);
    else select([objectId]);
  };

  return (
    <Shape
      id={objectId}
      opacity={self.opacity}
      // Re-read the endpoints every draw — this is the per-frame follow.
      sceneFunc={(ctx: Context, shape: ShapeNode) => {
        const geometry = geometryFor(shape, fromId, toId, style);
        if (!geometry) return; // an endpoint was deleted mid-flight
        const { points, anchors, strokeWidth } = geometry;

        if (isSelected) {
          tracePolyline(ctx, points);
          ctx.strokeStyle = GLOW_COLOUR;
          ctx.lineWidth = strokeWidth + GLOW_EXTRA;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.stroke();
        }

        tracePolyline(ctx, points);
        ctx.strokeStyle = tint;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();

        for (const anchor of anchors) {
          ctx.beginPath();
          ctx.arc(anchor.x, anchor.y, anchor.r, 0, Math.PI * 2, false);
          ctx.fillStyle = `${tint}33`;
          ctx.fill();
          ctx.strokeStyle = tint;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }}
      // Hit testing gets its own pass: a wide stroke along the line, drawn in
      // the shape's hit colour by `strokeShape`.
      hitFunc={(ctx: Context, shape: ShapeNode) => {
        const geometry = geometryFor(shape, fromId, toId, style);
        if (!geometry) return;
        tracePolyline(ctx, geometry.points);
        ctx.strokeShape(shape);
      }}
      hitStrokeWidth={HIT_WIDTH}
      onMouseDown={handleMouseDown}
      onTap={() => select([objectId])}
    />
  );
}
