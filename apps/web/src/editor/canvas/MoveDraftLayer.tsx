import { useMemo } from "react";
import { Circle, Group, Path } from "react-konva";
import {
  buildMotionPath,
  pathToSvgD,
  resolveObjectState,
  stateBeforeAnim,
  type Point,
} from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { useMoveDraft } from "./useMoveDraft";

/**
 * The route being drawn, while it is being drawn (plan §7).
 *
 * Deliberately its own layer rather than a mode inside `MotionPathLayer`: that
 * one draws routes that *exist*, and this one draws an intention. They look
 * alike on purpose — same colour, same curve maths — so what you are drawing is
 * visibly the thing you will get, but a draft has no waypoint handles, no
 * hit-testing and no document behind it.
 *
 * The line from the last committed corner to the cursor is the whole point: it
 * is what makes clicking corners feel like drawing rather than like entering
 * coordinates.
 */

const DRAFT = "#f2c744";

export function MoveDraftLayer() {
  const objectId = useMoveDraft((s) => s.objectId);
  const points = useMoveDraft((s) => s.points);
  const cursor = useMoveDraft((s) => s.cursor);
  const slideIndex = useMoveDraft((s) => s.slideIndex);
  const animId = useMoveDraft((s) => s.animId);
  const object = useEditorStore((s) => (objectId ? s.objects[objectId] : null));
  const slides = useEditorStore((s) => s.slides);

  const route = useMemo<Point[]>(() => {
    if (!object) return [];
    // The journey starts where the object stands when this move runs — the one
    // end that isn't drawn, because it is already on the board. A move drawn
    // after another one begins where that one left off, and a *redrawn* one
    // begins where its own leg did, not where the slide opened.
    const from = stateBeforeAnim(
      resolveObjectState(object, slides, slideIndex),
      slides[slideIndex]?.animations ?? [],
      object.id,
      animId,
    );
    const start = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    return [start, ...points, ...(cursor ? [cursor] : [])];
  }, [object, slides, slideIndex, animId, points, cursor]);

  const path = useMemo(
    () => (route.length >= 2 ? buildMotionPath(route, 0) : null),
    [route],
  );

  if (!objectId || !object) return null;

  return (
    <Group name="move-draft" listening={false}>
      {path && (
        <Path
          data={pathToSvgD(path)}
          stroke={DRAFT}
          strokeWidth={2}
          strokeScaleEnabled={false}
          dash={[6, 5]}
        />
      )}
      {/* Committed corners are solid; the one under the cursor is not drawn —
          it isn't a corner until it's clicked. */}
      {points.map((point, index) => (
        <Circle
          key={index}
          x={point.x}
          y={point.y}
          radius={6}
          fill="#0b0b0d"
          stroke={DRAFT}
          strokeWidth={2}
          strokeScaleEnabled={false}
        />
      ))}
    </Group>
  );
}
