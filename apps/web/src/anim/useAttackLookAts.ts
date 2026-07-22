import { useEffect } from "react";
import gsap from "gsap";
import type { Stage } from "konva/lib/Stage";
import { lookAtRotation, type Point } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";

/**
 * Parts kept turned towards other parts, **every frame** (plan §18.16).
 *
 * A look-at rotates one of an attack's own pieces so it stays pointed at
 * another — an indicator tracking the attack's own orb as the orb's animation
 * flies it across. The motion comes from the attack's animation, not from a
 * token being dragged, so this only earns its keep during playback: it lives in
 * the **viewer**, where the store holds the expanded parts and the transport
 * animates them. At rest the aimer already points as it was drawn, so the editor
 * needs nothing.
 *
 * It rides GSAP's ticker for the same reason the anchor runtime does (plan §8.1):
 * a callback added here runs *after* the tween engine has written this frame, so
 * it reads where the orb is now. It writes **only the aimer's rotation** — never
 * its position — so the animation still owns everything else about the part, and
 * the aimer turns about its own origin, which is what makes one pass exact.
 *
 * Reads positions in the layer's space, so it assumes the attack isn't also
 * anchored (which would put its parts inside a transformed group). Anchor is a
 * plan-following move of the whole attack; a look-at is an internal turn — a
 * definition wanting both is a later concern.
 */
export function useAttackLookAts(stageRef: { current: Stage | null }): void {
  const objects = useEditorStore((s) => s.objects);
  const attacks = useEditorStore((s) => s.attacks);
  const attackDefs = useEditorStore((s) => s.attackDefs);

  useEffect(() => {
    /** The rest geometry never changes mid-playthrough, so it's captured once. */
    const jobs: {
      aimerId: string;
      targetId: string;
      restRotation: number;
      restFrom: Point;
      restTo: Point;
    }[] = [];

    for (const instance of attacks) {
      const def = attackDefs[instance.attackId];
      for (const lookAt of def?.lookAts ?? []) {
        const aimerId = `${instance.id}::${lookAt.objectId}`;
        const targetId = `${instance.id}::${lookAt.targetId}`;
        const aimer = objects[aimerId];
        const target = objects[targetId];
        if (!aimer || !target) continue;
        jobs.push({
          aimerId,
          targetId,
          restRotation: aimer.base.rotation,
          // The aimer turns about its own origin; the target is aimed at by its
          // centre.
          restFrom: { x: aimer.base.x, y: aimer.base.y },
          restTo: {
            x: target.base.x + target.base.w / 2,
            y: target.base.y + target.base.h / 2,
          },
        });
      }
    }
    if (jobs.length === 0) return;

    const tick = () => {
      const stage = stageRef.current;
      if (!stage) return;

      for (const job of jobs) {
        const aimer = stage.findOne(`#${job.aimerId}`);
        const target = stage.findOne(`#${job.targetId}`);
        const layer = aimer?.getLayer();
        if (!aimer || !target || !layer) continue;

        const liveFrom = { x: aimer.x(), y: aimer.y() };
        const box = target.getClientRect({ relativeTo: layer });
        const liveTo = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

        aimer.rotation(
          lookAtRotation(
            job.restRotation,
            job.restFrom,
            job.restTo,
            liveFrom,
            liveTo,
          ),
        );
      }
      stageRef.current?.batchDraw();
    };

    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [objects, attacks, attackDefs, stageRef]);
}
