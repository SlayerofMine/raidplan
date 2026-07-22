import { useEffect } from "react";
import gsap from "gsap";
import type { Stage } from "konva/lib/Stage";
import {
  anchorPlacement,
  attackGroupId,
  type AttackDef,
  type AttackInstance,
} from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";

/**
 * Attacks that follow the board, **every frame** (plan §18.15).
 *
 * An anchored attack hangs off one of the plan's objects and turns to face
 * another — a frontal aimed from the boss at a player. Both of those move: the
 * boss is animated, the player is dragged. So the placement can't be baked into
 * the document at expansion; it has to be recomputed as often as the thing it
 * follows changes, which is per frame.
 *
 * It rides GSAP's ticker rather than React, for the same reason playback does
 * (plan §8.1): a callback added here runs *after* the tween engine has written
 * this frame's positions, so it reads where the boss is now, not where he was.
 *
 * What it writes is a **correction** on the group holding the attack's parts,
 * not on the parts themselves. The parts stay exactly where expansion put them —
 * animations included — and the group carries them bodily to where the anchor
 * says the attack should be. That keeps one truth about a part's position and
 * spares this from fighting the animation engine over it.
 */
export function useAttackAnchors(stageRef: { current: Stage | null }): void {
  const attacks = useEditorStore((s) => s.attacks);
  const attackDefs = useEditorStore((s) => s.attackDefs);

  useEffect(() => {
    const anchored = attacks
      .map((instance) => ({ instance, def: attackDefs[instance.attackId] }))
      .filter((pair): pair is { instance: AttackInstance; def: AttackDef } =>
        Boolean(pair.def?.anchor),
      );
    if (anchored.length === 0) return;

    const tick = () => {
      const stage = stageRef.current;
      if (!stage) return;

      for (const { instance, def } of anchored) {
        const group = stage.findOne(`#${attackGroupId(instance.id)}`);
        if (!group) continue;

        const placed = anchorPlacement(def, instance, (objectId) => {
          const node = stage.findOne(`#${objectId}`);
          const layer = node?.getLayer();
          if (!node || !layer) return null;
          const box = node.getClientRect({ relativeTo: layer });
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });
        // Nothing to follow — leave the placement as the plan stored it.
        if (!placed) continue;

        // Turn about the rectangle's centre and move it: the difference between
        // where the attack was stamped and where it belongs now.
        const stored = {
          x: instance.x + instance.w / 2,
          y: instance.y + instance.h / 2,
        };
        group.setAttrs({
          offsetX: stored.x,
          offsetY: stored.y,
          x: placed.x + instance.w / 2,
          y: placed.y + instance.h / 2,
          rotation: placed.rotation - instance.rotation,
        });
      }
      stageRef.current?.batchDraw();
    };

    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [attacks, attackDefs, stageRef]);
}
