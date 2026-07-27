import { useMemo } from "react";
import { Circle, Group, Line, Path } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useShallow } from "zustand/react/shallow";
import {
  buildMotionPath,
  isFollowing,
  pathTangent,
  pathToSvgD,
  resolveObjectState,
  type Anim,
  type MotionPath,
  type Point,
} from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";

/**
 * The routes `move` animations follow, drawn on the board (plan §7 "Motion
 * paths").
 *
 * Editor chrome, never shown in the viewer: it exists so a planner can *see and
 * shape* the line a token takes instead of inferring it from two positions. The
 * curve comes from the same `buildMotionPath` the player walks, so what is drawn
 * is what will happen.
 *
 * The endpoints are **not** editable here, on purpose. A route starts where the
 * previous slide left the object and ends where this slide puts it, so its ends
 * are views of the slides rather than data of their own — you move them by
 * dragging the object, which is the gesture that already means "it ends up
 * here". Only the interior waypoints belong to the animation, and only those get
 * handles. That is what makes a route incapable of disagreeing with its slides.
 */

const ROUTE = "#f2c744";
const DIMMED = "#f2c74455";
/** Handle radius in native px. Stroke widths are unscaled so they stay legible zoomed out. */
const HANDLE = 7;
const ARROW = 16;
/** How wide a stripe along the line counts as "on the route" for a double-click. */
const HIT_WIDTH = 14;

interface Route {
  anim: Anim;
  /** The full route in centre coordinates: start, interior waypoints, end. */
  points: Point[];
  curve: number;
  selected: boolean;
  /** A followed object is placed every frame *after* its tween, so its route is a lie. */
  followed: boolean;
}

export function MotionPathLayer() {
  const slideIndex = useEditorStore((s) => s.currentSlideIndex);
  const slide = useEditorStore((s) => s.slides[s.currentSlideIndex]);
  const slides = useEditorStore((s) => s.slides);
  const objects = useEditorStore((s) => s.objects);
  const selectedIds = useEditorStore(useShallow((s) => s.selectedIds));
  const updateAnimation = useEditorStore((s) => s.updateAnimation);

  const routes = useMemo<Route[]>(() => {
    if (!slide) return [];
    const out: Route[] = [];
    for (const anim of slide.animations) {
      if (anim.effect !== "move") continue;
      const object = objects[anim.objectId];
      if (!object) continue;

      // Slide 0 has no slide before it, so `from` and `to` are the same layout
      // and the move covers no ground (see `resolveSlideTransition`).
      const from = resolveObjectState(
        object,
        slides,
        Math.max(slideIndex - 1, 0),
      );
      const to = resolveObjectState(object, slides, slideIndex);
      const waypoints = anim.params?.path ?? [];
      // Half-size from the *start* state, matching how `compileStep` converts
      // the route's centres back to the document's top-left coordinates.
      const half = { x: from.w / 2, y: from.h / 2 };
      const start = { x: from.x + half.x, y: from.y + half.y };
      const end = {
        x: (anim.params?.toX ?? to.x) + half.x,
        y: (anim.params?.toY ?? to.y) + half.y,
      };
      // A move that goes nowhere and bends nowhere is a dot, not a route.
      if (waypoints.length === 0 && start.x === end.x && start.y === end.y) {
        continue;
      }
      out.push({
        anim,
        points: [start, ...waypoints, end],
        curve: anim.params?.curve ?? 0,
        selected: selectedIds.includes(anim.objectId),
        followed: isFollowing(object.follow),
      });
    }
    return out;
  }, [slide, slides, slideIndex, objects, selectedIds]);

  if (routes.length === 0) return null;

  return (
    <Group name="motion-paths">
      {routes.map((route) => (
        <RouteShape
          key={route.anim.id}
          route={route}
          onWaypoints={(path) =>
            updateAnimation(slideIndex, route.anim.id, {
              params: { ...route.anim.params, path },
            })
          }
        />
      ))}
    </Group>
  );
}

function RouteShape({
  route,
  onWaypoints,
}: {
  route: Route;
  onWaypoints: (path: Point[]) => void;
}) {
  const { points, curve, selected, followed } = route;
  const path = useMemo(() => buildMotionPath(points, curve), [points, curve]);
  // Handles and hit-testing only for the selection: every route on a busy slide
  // wearing grabbable dots turns the board into a minefield.
  const editable = selected && !followed;
  const colour = editable ? ROUTE : DIMMED;

  // Interior waypoints only — `points` has the slide-derived ends bracketing
  // them, and those are moved by dragging the object itself.
  const waypoints = points.slice(1, -1);

  return (
    <Group>
      <Path
        data={pathToSvgD(path)}
        stroke={colour}
        strokeWidth={2}
        strokeScaleEnabled={false}
        // A followed object's position is overwritten every frame after its
        // tween, so the route it was given is not where it goes. Draw it faintly
        // rather than confidently, and refuse to let it be edited.
        dash={followed ? [2, 6] : [6, 5]}
        // Konva hit-tests a stroke at its drawn width, which is 2px — far too
        // fine to double-click. `hitStrokeWidth` widens the target only.
        hitStrokeWidth={HIT_WIDTH}
        listening={editable}
        onDblClick={(e: KonvaEventObject<MouseEvent>) => {
          const at = e.target.getRelativePointerPosition();
          if (at) onWaypoints(insertAt(waypoints, points, at));
        }}
      />
      <Arrowhead path={path} tip={points[points.length - 1]} colour={colour} />

      {editable &&
        waypoints.map((point, index) => (
          <Circle
            key={index}
            x={point.x}
            y={point.y}
            radius={HANDLE}
            fill="#0b0b0d"
            stroke={ROUTE}
            strokeWidth={2}
            strokeScaleEnabled={false}
            draggable
            onDragMove={(e: KonvaEventObject<DragEvent>) =>
              onWaypoints(replaceAt(waypoints, index, e.target.position()))
            }
            onDragEnd={(e: KonvaEventObject<DragEvent>) =>
              onWaypoints(replaceAt(waypoints, index, e.target.position()))
            }
            // Double-click takes a waypoint back out — the inverse of the
            // double-click on the line that put it there.
            onDblClick={() =>
              onWaypoints(waypoints.filter((_, i) => i !== index))
            }
          />
        ))}
    </Group>
  );
}

const replaceAt = (points: Point[], index: number, at: Point): Point[] =>
  points.map((p, i) => (i === index ? { x: at.x, y: at.y } : p));

/**
 * Put a new waypoint at `at`, in the right place in the list.
 *
 * "The right place" is decided by which *leg* of the route was clicked, not by
 * distance to the nearest existing waypoint: dropping a point on the third leg
 * has to make it the third waypoint even when the route doubles back and some
 * earlier one happens to be closer in space.
 */
function insertAt(waypoints: Point[], full: Point[], at: Point): Point[] {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i + 1 < full.length; i++) {
    const distance = distanceToSegment(at, full[i]!, full[i + 1]!);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  const next = [...waypoints];
  next.splice(best, 0, { x: at.x, y: at.y });
  return next;
}

/** Perpendicular distance from `p` to the segment `a`–`b` (not the infinite line). */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq),
        );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A chevron at the destination, so a route reads as one-way at a glance. */
function Arrowhead({
  path,
  tip,
  colour,
}: {
  path: MotionPath;
  tip: Point | undefined;
  colour: string;
}) {
  if (!tip) return null;
  // Just short of the end: a degenerate final segment has no direction at 1.
  const rad = (pathTangent(path, 0.999) * Math.PI) / 180;
  const wing = (spread: number) => ({
    x: tip.x - ARROW * Math.cos(rad + spread),
    y: tip.y - ARROW * Math.sin(rad + spread),
  });
  const a = wing(0.45);
  const b = wing(-0.45);
  return (
    <Line
      points={[a.x, a.y, tip.x, tip.y, b.x, b.y]}
      stroke={colour}
      strokeWidth={2}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
}
