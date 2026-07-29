import { useEffect } from "react";
import gsap from "gsap";
import type { Node } from "konva/lib/Node";
import type { Stage } from "konva/lib/Stage";
import { isFollowing, solveFollow, type Point } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { BASE_SIZE_ATTRS } from "./applyToStage";

/**
 * An object's size *right now*, in native pixels. `ObjectNode` stamps the size
 * it drew at as `baseW`/`baseH` and animation expresses size as a scale on top
 * (see `applyToStage`), so the two together are the only honest answer
 * mid-tween.
 */
function liveSizeOf(node: Node): { w: number; h: number } {
  const baseW = node.getAttr(BASE_SIZE_ATTRS.w) as number | undefined;
  const baseH = node.getAttr(BASE_SIZE_ATTRS.h) as number | undefined;
  return {
    w: (baseW ?? node.width()) * node.scaleX(),
    h: (baseH ?? node.height()) * node.scaleY(),
  };
}

/**
 * Things that follow other things, **every frame** (plan §18.17).
 *
 * A followed transform hangs off one object and turns towards another: a frontal
 * cast from the boss at a player, an indicator tracking an orb. All of those move
 * — the boss is animated, the player is dragged, the orb is tweened — so a
 * placement can't be baked into the document. It has to be recomputed as often as
 * the thing it follows changes, which is per frame.
 *
 * It rides GSAP's ticker rather than React, for the same reason playback does
 * (plan §8.1): a callback added here runs *after* the tween engine has written
 * this frame's positions, so it reads where the boss is now, not where he was.
 */
export function useFollowing(stageRef: { current: Stage | null }): void {
  const objects = useEditorStore((s) => s.objects);

  useEffect(() => {
    const parts = Object.values(objects).filter((o) => isFollowing(o.follow));
    if (parts.length === 0) return;

    /**
     * Where an object's centre is, in the space `node` is positioned in.
     *
     * Measured absolutely and then pulled back into the followed node's parent,
     * because the two are not always the same frame: a grouped object lives
     * inside the node its group is drawn in, and its target may not.
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

      for (const object of parts) {
        const node = stage.findOne(`#${object.id}`);
        if (!node) continue;

        // Size comes off the node too, not the document: `object.base.w/h` is
        // only the size the object was *created* at now that each slide carries
        // its own, and a part being scaled by its own animation has a different
        // one again this very frame. `ox`/`oy`/`dir` are genuinely
        // slide-independent, so those do come from the object.
        const size = liveSizeOf(node);
        const live = {
          x: node.x(),
          y: node.y(),
          w: size.w,
          h: size.h,
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

    // **First on the ticker, and it has to be.** This pass is what *places* a
    // followed node; everything else riding the ticker reads those nodes back —
    // the origin handle's correction, the selection frame. Those are
    // registered from components nested inside `CanvasStage`, and React flushes
    // effects child-first, so they land on the ticker ahead of this one and, in
    // plain add order, would run a frame behind: each would read a node that
    // React had just reset to its *document* placement and not yet re-solved,
    // and flash the chrome at the object's un-followed position for exactly one
    // frame. `prioritize` puts the placement in front of every reader.
    //
    // It also settles this hook's own churn: the deps below change on every
    // committed edit, so the callback is removed and re-added constantly, and a
    // plain re-add would shuffle it to the back of the queue mid-gesture.
    gsap.ticker.add(tick, false, true);
    return () => gsap.ticker.remove(tick);
  }, [objects, stageRef]);
}
