import { useMemo, useRef } from "react";
import { Circle, Group, Line, Path } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useShallow } from "zustand/react/shallow";
import {
  buildMotionPath,
  isFollowing,
  pathTangent,
  pathToSvgD,
  resolveObjectState,
  stateBeforeAnim,
  type Anim,
  type MotionPath,
  type Point,
} from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { beginGesture, endGesture } from "../../store/gestureHistory";

/**
 * The routes `move` animations follow, drawn on the board (plan §7 "Motion
 * paths").
 *
 * Editor chrome, never shown in the viewer: it exists so a planner can *see and
 * shape* the line a token takes instead of inferring it from two positions. The
 * curve comes from the same `buildMotionPath` the player walks, so what is drawn
 * is what will happen.
 *
 * A route starts where the object stands on **this** slide and ends where the
 * animation says — so the start is not editable here (drag the object; that is
 * already the gesture for "it starts here") while the destination and every
 * corner are the animation's own data and get handles.
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
  /** The object's half-size where the move starts — centres <-> top-left. */
  half: Point;
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

      // The journey begins where the object stands *by the time this move
      // plays* — its opening state with every earlier animation folded in, so a
      // chain of moves draws as one continuous line instead of every leg
      // starting again from where the slide opened.
      const from = stateBeforeAnim(
        resolveObjectState(object, slides, slideIndex),
        slide.animations,
        anim.objectId,
        anim.id,
      );
      const waypoints = anim.params?.path ?? [];
      // Half-size from the *start* state, matching how `compileStep` converts
      // the route's centres back to the document's top-left coordinates.
      const half = { x: from.w / 2, y: from.h / 2 };
      const start = { x: from.x + half.x, y: from.y + half.y };
      const end = {
        x: (anim.params?.toX ?? from.x) + half.x,
        y: (anim.params?.toY ?? from.y) + half.y,
      };
      // A move that goes nowhere and bends nowhere is a dot, not a route — an
      // undrawn one, which the panel prompts for rather than the board.
      if (waypoints.length === 0 && start.x === end.x && start.y === end.y) {
        continue;
      }
      out.push({
        anim,
        points: [start, ...waypoints, end],
        curve: anim.params?.curve ?? 0,
        half,
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
          onDestination={(at) =>
            updateAnimation(slideIndex, route.anim.id, {
              params: {
                ...route.anim.params,
                // Handles are dragged as centres; the document stores top-left.
                toX: at.x - route.half.x,
                toY: at.y - route.half.y,
              },
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
  onDestination,
}: {
  route: Route;
  onWaypoints: (path: Point[]) => void;
  onDestination: (at: Point) => void;
}) {
  const { points, curve, selected, followed } = route;
  const path = useMemo(() => buildMotionPath(points, curve), [points, curve]);
  // Handles and hit-testing only for the selection: every route on a busy slide
  // wearing grabbable dots turns the board into a minefield.
  const editable = selected && !followed;
  const colour = editable ? ROUTE : DIMMED;

  // The corners between the two ends. The start is the object's own position
  // (drag the object to move it); the destination gets its own handle below.
  const waypoints = points.slice(1, -1);
  const destination = points[points.length - 1];

  // Where the handle stood when the current drag started, so its release can be
  // recorded as one undo step instead of one per frame (see `gestureHistory`).
  const before = useRef<(() => void) | null>(null);
  const startDrag = (rewind: () => void) => {
    before.current = rewind;
    beginGesture();
  };
  const endDrag = (commit: () => void) => {
    const rewind = before.current;
    before.current = null;
    endGesture({ rewind: rewind ?? (() => {}), commit });
  };

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
            onDragStart={() => {
              const start = waypoints;
              startDrag(() => onWaypoints(start));
            }}
            onDragMove={(e: KonvaEventObject<DragEvent>) =>
              onWaypoints(replaceAt(waypoints, index, e.target.position()))
            }
            onDragEnd={(e: KonvaEventObject<DragEvent>) => {
              const at = e.target.position();
              endDrag(() => onWaypoints(replaceAt(waypoints, index, at)));
            }}
            // Double-click takes a waypoint back out — the inverse of the
            // double-click on the line that put it there.
            onDblClick={() =>
              onWaypoints(waypoints.filter((_, i) => i !== index))
            }
          />
        ))}

      {/* The destination belongs to the animation now, not to a slide, so it is
          dragged here rather than by moving the object. Filled, to read as the
          end of the journey rather than as another corner. */}
      {editable && destination && (
        <Circle
          x={destination.x}
          y={destination.y}
          radius={HANDLE}
          fill={ROUTE}
          stroke="#0b0b0d"
          strokeWidth={2}
          strokeScaleEnabled={false}
          draggable
          onDragStart={() => {
            const start = destination;
            startDrag(() => onDestination(start));
          }}
          onDragMove={(e: KonvaEventObject<DragEvent>) =>
            onDestination(e.target.position())
          }
          onDragEnd={(e: KonvaEventObject<DragEvent>) => {
            const at = e.target.position();
            endDrag(() => onDestination(at));
          }}
        />
      )}
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
