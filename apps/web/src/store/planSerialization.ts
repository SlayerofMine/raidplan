import {
  SCHEMA_VERSION,
  type Background,
  type Plan,
  type PlanObject,
  type Step,
} from "@raidplan/shared";

/**
 * The **document** slice of the editor state: everything that belongs to the
 * plan (and therefore gets persisted and undone), as opposed to ephemeral view
 * and selection state (plan §5 / §6).
 *
 * The store keeps objects *normalized* (`objects` map + `objectIds` order) for
 * fine-grained subscriptions; the wire/storage format is the shared `Plan`
 * schema with a plain array. These two pure functions are the only bridge, so
 * the mapping is trivially round-trip testable.
 */
export interface PlanDoc {
  id: string;
  title: string;
  raid: string;
  /** Which encounter seeded this plan (plan §17) — drives the attack palette. */
  encounterId?: string | undefined;
  background: Background;
  objects: Record<string, PlanObject>;
  /** Render/stacking order — also the array order in the serialized Plan. */
  objectIds: string[];
  /** Carried through untouched in Phase 2; Phase 3 makes steps live. */
  steps: Step[];
}

/** Normalized editor document → the shared `Plan` document. */
export function toPlan(doc: PlanDoc): Plan {
  return {
    id: doc.id,
    title: doc.title,
    raid: doc.raid,
    ...(doc.encounterId ? { encounterId: doc.encounterId } : {}),
    background: doc.background,
    objects: doc.objectIds
      .map((id) => doc.objects[id])
      .filter((o): o is PlanObject => o !== undefined),
    steps: doc.steps,
    schemaVersion: SCHEMA_VERSION,
  };
}

/** The shared `Plan` document → normalized editor document. */
export function fromPlan(plan: Plan): PlanDoc {
  const objects: Record<string, PlanObject> = {};
  const objectIds: string[] = [];
  for (const object of plan.objects) {
    objects[object.id] = object;
    objectIds.push(object.id);
  }
  return {
    id: plan.id,
    title: plan.title,
    raid: plan.raid,
    encounterId: plan.encounterId,
    background: plan.background,
    objects,
    objectIds,
    steps: plan.steps,
  };
}
