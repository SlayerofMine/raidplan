import {
  SCHEMA_VERSION,
  type AttackInstance,
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
  /**
   * Placed attacks (plan §18.3). Like objects they belong to the plan rather
   * than to a slide; each names the step it fires on.
   */
  attacks: AttackInstance[];
  steps: Step[];
}

/**
 * Every slice of the document, named once.
 *
 * Three separate things need to answer *"did the document change?"* — local
 * autosave, remote autosave and undo — and each used to carry its own
 * hand-written list of fields. Adding `attacks` to the document quietly missed
 * all three, so a plan whose only content was an attack never saved at all.
 *
 * Typing this as a **total** record over `PlanDoc` means the next field added to
 * the document is a compile error here rather than a plan that silently stops
 * saving.
 */
const DOC_SLICES: Record<keyof PlanDoc, true> = {
  id: true,
  title: true,
  raid: true,
  encounterId: true,
  background: true,
  objects: true,
  objectIds: true,
  attacks: true,
  steps: true,
};

export const PLAN_DOC_KEYS = Object.keys(DOC_SLICES) as (keyof PlanDoc)[];

/**
 * Has the *document* changed? Immer keeps untouched slices referentially
 * stable, so comparing each slice by reference ignores camera and selection
 * churn without walking the plan.
 */
export function sameDocument(a: PlanDoc, b: PlanDoc): boolean {
  return PLAN_DOC_KEYS.every((key) => a[key] === b[key]);
}

/** The document slice of the wider editor state — what undo snapshots. */
export function pickPlanDoc(state: PlanDoc): PlanDoc {
  // `Object.fromEntries` can't know the keys cover PlanDoc; `DOC_SLICES` does.
  return Object.fromEntries(
    PLAN_DOC_KEYS.map((key) => [key, state[key]]),
  ) as unknown as PlanDoc;
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
    attacks: doc.attacks,
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
    attacks: plan.attacks,
    steps: plan.steps,
  };
}
