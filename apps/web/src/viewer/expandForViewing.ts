import {
  attackIdsInPlan,
  expandPlan,
  type AttackDef,
  type Plan,
} from "@raidplan/shared";
import { api } from "../api/client";
import { useEditorStore } from "../store/editorStore";

/**
 * Prepare a plan for read-only playback (plan §17, stage 3).
 *
 * Attacks are stored by reference, so before the viewer hydrates its store we
 * fetch the definitions the plan points at and `expandPlan` them into concrete
 * objects and animations. The viewer then draws and animates attacks with no
 * special-casing — they're just more objects.
 *
 * A plan with no attacks (the overwhelming common case, and every offline plan
 * today) is returned untouched **without touching the network**, so playback and
 * the offline plan keep working with no API round-trip.
 */
export async function expandForViewing(doc: Plan): Promise<Plan> {
  const ids = attackIdsInPlan(doc);
  if (ids.length === 0) return doc;

  const defs = await api.attack.byIds.query({ ids });
  const byId: Record<string, AttackDef> = {};
  for (const def of defs) byId[def.id] = def;
  // The anchor runtime resolves an instance against its definition per frame.
  useEditorStore.getState().setAttackDefs(byId);
  // The instances are kept alongside the expansion rather than cleared: an
  // anchored attack is placed per frame from where its anchors are *now*
  // (§18.15), and the runtime needs to know which parts follow what. Nothing in
  // the viewer draws instances, so they cost nothing but a reference.
  return { ...expandPlan(doc, byId), attacks: doc.attacks };
}
