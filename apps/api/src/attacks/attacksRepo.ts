import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import {
  AttackDefSchema,
  attackIdsInPlan,
  type AttackDef,
  type Plan,
} from "@raidplan/shared";
import type { Db } from "../db/client.js";
import { attacks } from "../db/schema.js";

/** The editable body of an attack (everything but its identity and version). */
export type AttackContent = Pick<
  AttackDef,
  "name" | "box" | "anchor" | "objects" | "animations"
>;

/**
 * Data access for attack definitions (plan §17, stage 3). Transport-free like
 * the other repos. The `AttackDef` is stored as JSON and re-validated on read,
 * so a row written by an older build can never crash a renderer that expands it.
 */
function parseDef(doc: string): AttackDef | undefined {
  let json: unknown;
  try {
    json = JSON.parse(doc);
  } catch {
    return undefined; // a corrupt row must never crash a render
  }
  const parsed = AttackDefSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/** Resolve a set of attack ids to their current definitions, keyed by id. */
export function getAttackDefsByIds(
  db: Db,
  ids: readonly string[],
): Record<string, AttackDef> {
  const out: Record<string, AttackDef> = {};
  if (ids.length === 0) return out;
  const rows = db
    .select()
    .from(attacks)
    .where(inArray(attacks.id, [...ids]))
    .all();
  for (const row of rows) {
    const def = parseDef(row.doc);
    if (def) out[row.id] = def;
  }
  return out;
}

/**
 * The definitions a plan needs to be expanded — exactly the attacks its steps
 * reference (auto-follow: whatever version is current). Empty for a plan with no
 * attacks, so expanding it is a no-op.
 */
export function attackDefsForPlan(
  db: Db,
  plan: Plan,
): Record<string, AttackDef> {
  return getAttackDefsByIds(db, attackIdsInPlan(plan));
}

/** An encounter's attacks, for the designer/palette. */
export function listAttacksForEncounter(
  db: Db,
  encounterId: string,
): AttackDef[] {
  return db
    .select()
    .from(attacks)
    .where(eq(attacks.encounterId, encounterId))
    .orderBy(asc(attacks.name))
    .all()
    .flatMap((row) => {
      const def = parseDef(row.doc);
      return def ? [def] : [];
    });
}

/** One definition by id, for the designer to open. */
export function getAttack(db: Db, id: string): AttackDef | undefined {
  const row = db.select().from(attacks).where(eq(attacks.id, id)).get();
  return row ? parseDef(row.doc) : undefined;
}

/** Create a new attack (version 1) from the designer. */
export function createAttack(
  db: Db,
  input: { encounterId: string } & AttackContent,
): AttackDef {
  const def: AttackDef = { id: randomUUID(), version: 1, ...input };
  saveAttack(db, def);
  return def;
}

/**
 * Replace an attack's body, bumping its version. Version drives auto-follow's
 * future "changed" marker (plan §17): a plan using this attack picks up the edit
 * automatically. `encounterId` is immutable — an attack belongs to its
 * encounter. Returns `undefined` if no such attack.
 */
export function updateAttack(
  db: Db,
  id: string,
  content: AttackContent,
): AttackDef | undefined {
  const existing = getAttack(db, id);
  if (!existing) return undefined;
  const def: AttackDef = {
    ...content,
    id,
    encounterId: existing.encounterId,
    version: existing.version + 1,
  };
  saveAttack(db, def);
  return def;
}

/** Delete an attack. Returns whether a row was actually removed. */
export function deleteAttack(db: Db, id: string): boolean {
  return db.delete(attacks).where(eq(attacks.id, id)).run().changes > 0;
}

/**
 * Insert or replace a definition by its id. The admin authoring UI (stage 4)
 * writes through {@link createAttack}/{@link updateAttack}; this is the shared
 * primitive and backs tests.
 */
export function saveAttack(db: Db, def: AttackDef): void {
  const doc = JSON.stringify(def);
  const at = Math.floor(Date.now() / 1000);
  db.insert(attacks)
    .values({
      id: def.id,
      encounterId: def.encounterId,
      name: def.name,
      version: def.version,
      doc,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: attacks.id,
      set: {
        encounterId: def.encounterId,
        name: def.name,
        version: def.version,
        doc,
        updatedAt: at,
      },
    })
    .run();
}
