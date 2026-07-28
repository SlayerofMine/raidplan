import {
  normalizeSlides,
  SCHEMA_VERSION,
  type AttackInstance,
  type Background,
  type Plan,
  type PlanObject,
  type Slide,
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
   * than to a slide; each names the slide it fires on.
   */
  attacks: AttackInstance[];
  /**
   * What each group is called, by `groupId` (plan §18.1). Membership lives on
   * the objects; this holds only the name, so an entry with no members left is
   * merely litter rather than a broken group — see the store's `pruneGroups`.
   */
  groups: Record<string, string>;
  slides: Slide[];
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
  groups: true,
  slides: true,
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

/**
 * Bring group membership and group names back into agreement (plan §18.1).
 *
 * A group exists precisely when **two or more** objects share a `groupId`, so a
 * group that deleting or ungrouping has worn down to one member is not a group
 * any more: its last member is set loose rather than left in a group of one,
 * where "select the group" would be indistinguishable from selecting the object
 * and the panel would show a container holding a single thing. Names whose group
 * has gone go with it, so a later group can never inherit a stranger's name.
 *
 * Mutates in place, which is what lets the store call it on an immer draft and
 * `fromPlan` call it on a freshly built document.
 */
export function pruneGroups(doc: {
  objects: Record<string, PlanObject>;
  groups: Record<string, string>;
}): void {
  const counts = new Map<string, number>();
  for (const object of Object.values(doc.objects)) {
    const groupId = object.groupId;
    if (groupId) counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }
  for (const object of Object.values(doc.objects)) {
    const groupId = object.groupId;
    if (groupId && (counts.get(groupId) ?? 0) < 2) delete object.groupId;
  }
  for (const groupId of Object.keys(doc.groups)) {
    if ((counts.get(groupId) ?? 0) < 2) delete doc.groups[groupId];
  }
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
    groups: doc.groups,
    slides: doc.slides,
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * The shared `Plan` document → normalized editor document.
 *
 * Slides are normalised on the way in, which is the one place a document from
 * *outside* the store (a load, an import, a stale autosave) is stripped of
 * entries and animations naming objects the plan doesn't have. A *missing*
 * entry is left alone — that is the object not being in that scene.
 */
export function fromPlan(plan: Plan): PlanDoc {
  const objects: Record<string, PlanObject> = {};
  const objectIds: string[] = [];
  for (const object of plan.objects) {
    objects[object.id] = object;
    objectIds.push(object.id);
  }
  const doc: PlanDoc = {
    id: plan.id,
    title: plan.title,
    raid: plan.raid,
    encounterId: plan.encounterId,
    background: plan.background,
    objects,
    objectIds,
    attacks: plan.attacks,
    groups: { ...plan.groups },
    slides: normalizeSlides(plan.objects, plan.slides),
  };
  // The same load-time repair `normalizeSlides` does for the slides: a document
  // from outside the store can name groups that its objects no longer join.
  pruneGroups(doc);
  return doc;
}
