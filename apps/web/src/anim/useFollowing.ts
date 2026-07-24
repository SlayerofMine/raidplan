import { useEffect } from "react";
import gsap from "gsap";
import type { Node } from "konva/lib/Node";
import type { Stage } from "konva/lib/Stage";
import {
  attackFollow,
  attackGroupId,
  attackPlacement,
  attackTransform,
  isFollowing,
  pivotPoint,
  solveFollow,
  type Point,
} from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";

/**
 * Things that follow other things, **every frame** (plan §18.17).
 *
 * A followed transform hangs off one object and turns towards another: a frontal
 * cast from the boss at a player, an indicator tracking the attack's own orb. All
 * of those move — the boss is animated, the player is dragged, the orb is tweened
 * — so a placement can't be baked into the document at expansion. It has to be
 * recomputed as often as the thing it follows changes, which is per frame.
 *
 * It rides GSAP's ticker rather than React, for the same reason playback does
 * (plan §8.1): a callback added here runs *after* the tween engine has written
 * this frame's positions, so it reads where the boss is now, not where he was.
 *
 * This one hook replaced `useAttackAnchors` and `useAttackLookAts`, which were
 * the same idea at two scales. Running them as two passes of one tick is what
 * closes the hole §18.16 left open — an attack could be anchored *or* have a
 * part that aims, never both, because the two hooks couldn't agree on whose
 * frame a position was measured in. Here the group settles first and the parts
 * are then solved against the board as it now stands.
 */
export function useFollowing(stageRef: { current: Stage | null }): void {
  const objects = useEditorStore((s) => s.objects);
  const attacks = useEditorStore((s) => s.attacks);
  const attackDefs = useEditorStore((s) => s.attackDefs);

  useEffect(() => {
    // Whole attacks that follow the plan — these move a group bodily.
    const groups = attacks
      .map((instance) => ({ instance, def: attackDefs[instance.attackId] }))
      .filter(({ def, instance }) =>
        def ? isFollowing(attackFollow(def, instance)) : false,
      );

    // Individual objects that follow — a plan's own shape, or one of an
    // attack's parts, which by now is an ordinary object in the store.
    const parts = Object.values(objects).filter((o) => isFollowing(o.follow));

    if (groups.length === 0 && parts.length === 0) return;

    /**
     * Where an object's centre is, in the space `node` is positioned in.
     *
     * Measured absolutely and then pulled back into the followed node's parent,
     * because the two are not always the same frame: an attack's part lives
     * inside the group its attack was carried by, and its target may not.
     */
    const centreIn =
      (node: Node) =>
      (targetId: string): Point | null => {
        const stage = stageRef.current;
        const target = stage?.findOne(`#${targetId}`);
        if (!target) return null;
        const box = target.getClientRect();
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const parent = node.getParent();
        return parent
          ? parent.getAbsoluteTransform().copy().invert().point(centre)
          : centre;
      };

    const tick = () => {
      const stage = stageRef.current;
      if (!stage) return;

      // Pass one: carry whole attacks to where the board says they belong.
      for (const { instance, def } of groups) {
        const group = stage.findOne(`#${attackGroupId(instance.id)}`);
        if (!group) continue;

        const placed = attackPlacement(def!, instance, centreIn(group));
        // Nothing to follow — leave the placement as the plan stored it.
        if (!placed) continue;

        // The parts stay exactly where expansion and the animations put them;
        // the group carries them. So this is a *correction*: turn about the
        // origin the attack was stamped with, and put that origin where the
        // placement wants it. One truth about a part's position, and nothing
        // here ever fights the tween engine for it (§18.15).
        const stored = attackTransform(def!, instance);
        const from = pivotPoint(stored);
        const to = pivotPoint({
          ...stored,
          x: placed.x,
          y: placed.y,
          rotation: placed.rotation,
        });
        group.setAttrs({
          offsetX: from.x,
          offsetY: from.y,
          x: to.x,
          y: to.y,
          rotation: placed.rotation - stored.rotation,
        });
      }

      // Pass two: turn and place the individual followers, reading the board
      // *after* pass one — so a part inside a carried group can aim at
      // something outside it and still be measured in the same frame.
      for (const object of parts) {
        const node = stage.findOne(`#${object.id}`);
        if (!node) continue;

        const live = {
          x: node.x(),
          y: node.y(),
          w: object.base.w,
          h: object.base.h,
          rotation: node.rotation(),
          ox: object.base.ox,
          oy: object.base.oy,
          dir: object.base.dir,
        };
        const placed = solveFollow(live, object.follow, centreIn(node));
        if (!placed) continue;

        // Read from the live node rather than the document: whatever the
        // animation has done to this part so far this frame is the position the
        // follow adjusts, not the one it was authored at.
        node.setAttrs({
          x: placed.x,
          y: placed.y,
          rotation: placed.rotation,
        });
      }

      stage.batchDraw();
    };

    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [objects, attacks, attackDefs, stageRef]);
}
