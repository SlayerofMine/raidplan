/**
 * Process-unique ids for document entities. Ids only need to be unique within a
 * plan — they're never used for ordering or persistence-stable identity — so a
 * timestamp plus a monotonic counter is plenty and keeps creation synchronous.
 */
let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export const nextObjectId = (): string => nextId("obj");
export const nextStepId = (): string => nextId("step");
export const nextAnimId = (): string => nextId("anim");
/** A placed attack instance (plan §17); namespaces its expanded objects. */
export const nextAttackId = (): string => nextId("atk");
