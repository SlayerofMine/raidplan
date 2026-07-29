import {
  makeEmptyPlan,
  type AttackDef,
  type AttackParam,
  type Plan,
} from "@raidplan/shared";

/**
 * A definition, as a plan the ordinary editor can open — and back (plan §21).
 *
 * The Attack Designer is the editor, in a sandbox. That is only possible because
 * a definition is deliberately *a slice of a Plan*: its objects are plan objects
 * and its slide is a plan slide, so opening one is a matter of putting those two
 * things into a plan-shaped wrapper and handing it to the store. Nothing in the
 * canvas, the properties column, the timeline or the player learns that it is
 * looking at an attack.
 *
 * The wrapper borrows the parent plan's **background**, so a mechanic is drawn
 * at the size and against the map it will be used on. It carries no attacks of
 * its own: an attack made of attacks is a thing to decide on deliberately, not
 * to fall into.
 *
 * Both directions are pure, so a round trip is trivially testable and the save
 * path has nothing in it but a splice.
 */

/** The plan id the sandbox uses — never persisted under it. */
export const DESIGNER_PLAN_ID = "attack-designer";

/** Open a definition (or start a new one) as a one-slide plan. */
export function attackToPlan(parent: Plan, def: AttackDef | undefined): Plan {
  const base = makeEmptyPlan({
    id: DESIGNER_PLAN_ID,
    title: def?.name ?? "New attack",
    raid: parent.raid,
    background: parent.background,
  });
  if (!def) return base;
  return {
    ...base,
    objects: def.objects,
    // Exactly one, by construction — an attack is a thing that happens, and a
    // thing that happens has one scene.
    slides: [def.slide],
  };
}

/** Read the sandbox back out as a definition. */
export function planToAttack(
  doc: Plan,
  identity: { id: string; name: string; source: AttackDef["source"] },
  params: readonly AttackParam[],
): AttackDef {
  const slide = doc.slides[0];
  return {
    id: identity.id,
    name: identity.name.trim() || "Untitled attack",
    source: identity.source,
    objects: doc.objects,
    slide: slide ?? { id: "def-slide", states: {}, animations: [] },
    // Only the parameters that still name something the definition has: a
    // binding to an object or animation that was deleted while designing would
    // be a write the stamp could never make.
    params: params.filter((param) =>
      param.targets.every((target) =>
        target.on === "object"
          ? doc.objects.some((o) => o.id === target.targetId)
          : (slide?.animations.some((a) => a.id === target.targetId) ?? false),
      ),
    ),
  };
}

/** Put a definition into a plan's library, replacing the one it supersedes. */
export function upsertAttack(plan: Plan, def: AttackDef): Plan {
  const at = plan.attacks.findIndex((a) => a.id === def.id);
  const attacks =
    at === -1
      ? [...plan.attacks, def]
      : plan.attacks.map((a, i) => (i === at ? def : a));
  return { ...plan, attacks };
}
