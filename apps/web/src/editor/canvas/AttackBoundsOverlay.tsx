import { Group, Rect, Text } from "react-konva";
import { attackContentBox, attackContentOf } from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";

/**
 * The attack's own bounding box, drawn in the designer (plan §18.2).
 *
 * This rectangle *is* the attack: unit space is pinned to it, it's the frame a
 * planner grabs, and its size is stored as the definition's `defaultSize`. It is
 * measured, never typed — which is why the designer shows it rather than asking
 * for numbers.
 *
 * It covers the attack's whole life: where its parts start, where the End
 * slide leaves them, and everywhere a motion carries them. So an author who sends
 * something flying off to one side can see the footprint grow to include it.
 */
const OUTLINE = "#f2c744";

export function AttackBoundsOverlay() {
  const getPlan = useEditorStore((s) => s.getPlan);
  // Subscribed rather than read once: the outline has to follow every edit, and
  // these are the slices `attackContentOf` actually reads.
  useEditorStore((s) => s.objects);
  useEditorStore((s) => s.objectIds);
  useEditorStore((s) => s.slides);

  // Measure the *saved* body, not the canvas: `attackContentOf` is what
  // `planToAttackContent` runs on save, so the dashed frame and the stored
  // `defaultSize` can't disagree.
  const box = attackContentBox(attackContentOf(getPlan()));
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
