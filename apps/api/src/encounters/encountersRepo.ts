import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  DEFAULT_ENCOUNTERS,
  EncounterPresetSchema,
  type EncounterPreset,
  type EncounterSummary,
} from "@raidplan/shared";
import type { Db } from "../db/client.js";
import { encounters } from "../db/schema.js";

/**
 * Data access for encounter presets (plan §17, stage 1). Transport-free like
 * `planRepo`: the router decides *who may*, this decides *what is*.
 *
 * The `EncounterPreset` (background + pre-placed objects + steps) is stored as
 * JSON in `doc` and re-validated on read, so a row written by an older build can
 * never crash a reader — the same discipline as `getPlanWithDoc`.
 */
export interface EncounterRecord {
  id: string;
  slug: string;
  raid: string;
  name: string;
  preset: EncounterPreset;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function parsePreset(doc: string): EncounterPreset | undefined {
  const parsed = EncounterPresetSchema.safeParse(JSON.parse(doc));
  return parsed.success ? parsed.data : undefined;
}

/**
 * Encounters for the selector — grouped-by-raid friendly (ordered by raid then
 * name), carrying only a summary. A row whose stored doc no longer parses is
 * skipped rather than breaking the whole list.
 */
export function listEncounters(db: Db): EncounterSummary[] {
  return db
    .select()
    .from(encounters)
    .orderBy(asc(encounters.raid), asc(encounters.name))
    .all()
    .flatMap((row) => {
      const preset = parsePreset(row.doc);
      if (!preset) return [];
      return [
        {
          id: row.id,
          slug: row.slug,
          raid: row.raid,
          name: row.name,
          background: preset.background,
        },
      ];
    });
}

/** One encounter with its full preset body, for seeding a new plan. */
export function getEncounter(db: Db, id: string): EncounterRecord | undefined {
  const row = db.select().from(encounters).where(eq(encounters.id, id)).get();
  if (!row) return undefined;
  const preset = parsePreset(row.doc);
  if (!preset) return undefined;
  return { id: row.id, slug: row.slug, raid: row.raid, name: row.name, preset };
}

/**
 * Insert an encounter, or update the existing one with the same `slug`. The
 * slug is the stable identity (admin CRUD and the seed both key on it), so
 * re-saving never orphans references.
 */
export function upsertEncounter(
  db: Db,
  input: { slug: string; raid: string; name: string; preset: EncounterPreset },
): EncounterRecord {
  const at = nowSeconds();
  const doc = JSON.stringify(input.preset);
  const existing = db
    .select()
    .from(encounters)
    .where(eq(encounters.slug, input.slug))
    .get();

  if (existing) {
    db.update(encounters)
      .set({ raid: input.raid, name: input.name, doc, updatedAt: at })
      .where(eq(encounters.id, existing.id))
      .run();
    return {
      id: existing.id,
      slug: input.slug,
      raid: input.raid,
      name: input.name,
      preset: input.preset,
    };
  }

  const id = randomUUID();
  db.insert(encounters)
    .values({
      id,
      slug: input.slug,
      raid: input.raid,
      name: input.name,
      doc,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  return { id, ...input };
}

/**
 * Seed the starter encounters (plan §17). **Insert-if-absent**, never
 * overwrite: once the admin edits or deletes a seeded encounter, a later boot
 * must not resurrect or clobber it. Safe to call on every start.
 */
export function seedDefaultEncounters(db: Db): void {
  for (const encounter of DEFAULT_ENCOUNTERS) {
    const exists = db
      .select({ id: encounters.id })
      .from(encounters)
      .where(eq(encounters.slug, encounter.slug))
      .get();
    if (exists) continue;
    upsertEncounter(db, {
      slug: encounter.slug,
      raid: encounter.raid,
      name: encounter.name,
      preset: encounter.preset,
    });
  }
}
