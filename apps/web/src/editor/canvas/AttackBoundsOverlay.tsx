import { Group, Rect, Text } from "react-konva";
import { attackContentBox, type PlanObject } from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";

/**
 * The attack's own bounding box, drawn in the designer (plan §18.2).
 *
 * This rectangle *is* the attack: unit space is pinned to it, it's the frame a
 * planner grabs, and its size is stored as the definition's `defaultSize`. It is
 * measured, never typed — which is why the designer shows it rather than asking
 * for numbers.
 *
 * It covers the attack's whole life: where its parts start, where the step
 * leaves them, and everywhere a motion carries them. So an author who sends
 * something flying off to one side can see the footprint grow to include it.
 */
const OUTLINE = "#f2c744";

export function AttackBoundsOverlay() {
  const objects = useEditorStore((s) => s.objects);
  const objectIds = useEditorStore((s) => s.objectIds);
  const step = useEditorStore((s) => s.steps[0]);

  const box = attackContentBox({
    objects: objectIds
      .map((id) => objects[id])
      .filter((o): o is PlanObject => o !== undefined),
    overrides: step?.overrides ?? {},
    animations: step?.animations ?? [],
  });
  if (!box) return null;

  const w = box.hx * 2;
  const h = box.hy * 2;

  return (
    <Group listening={false}>
      <Rect
        x={box.cx - box.hx}
        y={box.cy - box.hy}
        width={w}
        height={h}
        stroke={OUTLINE}
        strokeWidth={1}
        dash={[8, 6]}
        opacity={0.7}
        strokeScaleEnabled={false}
      />
      <Text
        x={box.cx - box.hx}
        y={box.cy - box.hy - 22}
        text={`${Math.round(w)} × ${Math.round(h)}`}
        fontSize={16}
        fill={OUTLINE}
        opacity={0.7}
      />
    </Group>
  );
}
