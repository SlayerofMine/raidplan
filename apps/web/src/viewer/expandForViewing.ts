import {
  attackIdsInPlan,
  expandPlan,
  type AttackDef,
  type Plan,
} from "@raidplan/shared";
import { api } from "../api/client";

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
  return expandPlan(doc, byId);
}
