import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  DEFAULT_ENCOUNTERS,
  EncounterPresetSchema,
  type Background,
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

/** A readable, url-safe base slug from an encounter's name. */
function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "encounter";
}

/** `base`, or `base-2`, `base-3`… — the first form not already taken. */
function uniqueSlug(db: Db, base: string): string {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = db
      .select({ id: encounters.id })
      .from(encounters)
      .where(eq(encounters.slug, slug))
      .get();
    if (!taken) return slug;
  }
}

/**
 * Create an encounter from the admin panel (plan §17, stage 2). The slug is
 * derived from the name and de-duplicated, so the admin never has to invent one.
 * Content (objects/steps) starts empty — pre-placed content is authored later.
 */
export function createEncounter(
  db: Db,
  input: { raid: string; name: string; background: Background },
): EncounterRecord {
  return upsertEncounter(db, {
    slug: uniqueSlug(db, slugifyName(input.name)),
    raid: input.raid,
    name: input.name,
    preset: { background: input.background, objects: [], steps: [] },
  });
}

/**
 * Patch an encounter's editable fields. **Objects and steps are preserved** —
 * the admin panel only edits name/raid/background, so an update must never wipe
 * pre-placed content it doesn't manage. Returns `undefined` if no such row.
 */
export function updateEncounter(
  db: Db,
  id: string,
  patch: { raid?: string; name?: string; background?: Background },
): EncounterRecord | undefined {
  const existing = getEncounter(db, id);
  if (!existing) return undefined;

  const raid = patch.raid ?? existing.raid;
  const name = patch.name ?? existing.name;
  const preset: EncounterPreset = {
    ...existing.preset,
    ...(patch.background ? { background: patch.background } : {}),
  };

  db.update(encounters)
    .set({ raid, name, doc: JSON.stringify(preset), updatedAt: nowSeconds() })
    .where(eq(encounters.id, id))
    .run();
  return { id, slug: existing.slug, raid, name, preset };
}

/** Delete an encounter. Returns whether a row was actually removed. */
export function deleteEncounter(db: Db, id: string): boolean {
  const result = db.delete(encounters).where(eq(encounters.id, id)).run();
  return result.changes > 0;
}
