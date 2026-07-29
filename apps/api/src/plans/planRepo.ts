import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  makePlanFromPreset,
  PlanSchema,
  SCHEMA_VERSION,
  type Plan,
} from "@raidplan/shared";
import type { Db } from "../db/client.js";
import { planData, plans, planVersions } from "../db/schema.js";
import type { PlanAcl } from "../auth/access.js";
import { generateSlug } from "./slug.js";

/**
 * Data access for plans (plan §9). Transport-free: no tRPC, no HTTP — the
 * router decides *who may*, this decides *what is*. Authorization lives in
 * `auth/access.ts` and is applied by the router, so these functions are honest
 * about being unguarded.
 */
export interface PlanSummary {
  id: string;
  slug: string;
  title: string;
  raid: string;
  ownerId: string;
  guildId: string | null;
  visibility: "private" | "unlisted" | "public";
  thumbnailUrl: string | null;
  updatedAt: number;
}

export interface PlanWithDoc extends PlanSummary {
  doc: Plan;
  /** Optimistic-concurrency token; pass back to `saveDoc` (plan §15). */
  version: number;
}

/** A stale save: someone else wrote since the client loaded (plan §15). */
export class PlanConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super("Plan was modified by someone else");
    this.name = "PlanConflictError";
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function toSummary(row: typeof plans.$inferSelect): PlanSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    raid: row.raid,
    ownerId: row.ownerId,
    guildId: row.guildId,
    visibility: row.visibility,
    thumbnailUrl: row.thumbnailUrl,
    updatedAt: row.updatedAt,
  };
}

/** The facts the access rules need, without loading the document. */
export function toAcl(row: typeof plans.$inferSelect): PlanAcl {
  return {
    ownerId: row.ownerId,
    guildId: row.guildId,
    visibility: row.visibility,
    deletedAt: row.deletedAt,
  };
}

export function createPlan(
  db: Db,
  params: {
    ownerId: string;
    guildId?: string | null;
    title?: string;
    background: Plan["background"];
    /** Encounter classification, mirrored to the `raid` column for listing. */
    raid?: string;
    /** Which encounter seeded this plan (plan §17). */
    encounterId?: string;
    /** Pre-placed content when seeding from an encounter preset (plan §17). */
    objects?: Plan["objects"];
    slides?: Plan["slides"];
  },
): PlanWithDoc {
  const id = randomUUID();
  const slug = generateSlug();
  // Built by the shared seeder rather than by overlaying the fields here. The
  // preset's `slides` defaults to `[]` — every bundled encounter is a background
  // and nothing else — and an empty array is truthy, so assigning it wiped the
  // opening slide `makeEmptyPlan` had just provided. The result was a plan with
  // no slides, which `PlanSchema` refuses to parse, so every plan created this
  // way 404'd on load: no background, no thumbnail, and a dead play button.
  const doc = makePlanFromPreset({
    id,
    ...(params.title !== undefined ? { title: params.title } : {}),
    ...(params.raid !== undefined ? { raid: params.raid } : {}),
    ...(params.encounterId !== undefined
      ? { encounterId: params.encounterId }
      : {}),
    preset: {
      background: params.background,
      objects: params.objects ?? [],
      slides: params.slides ?? [],
    },
  });
  const at = nowSeconds();

  db.transaction((tx) => {
    tx.insert(plans)
      .values({
        id,
        slug,
        ownerId: params.ownerId,
        guildId: params.guildId ?? null,
        title: doc.title,
        raid: doc.raid,
        visibility: "private",
        createdAt: at,
        updatedAt: at,
      })
      .run();
    tx.insert(planData)
      .values({
        planId: id,
        schemaVersion: SCHEMA_VERSION,
        doc: JSON.stringify(doc),
        version: 1,
        updatedAt: at,
      })
      .run();
  });

  return {
    id,
    slug,
    title: doc.title,
    raid: doc.raid,
    ownerId: params.ownerId,
    guildId: params.guildId ?? null,
    visibility: "private",
    thumbnailUrl: null,
    updatedAt: at,
    doc,
    version: 1,
  };
}

/** The raw row, including soft-deleted ones — callers apply the access rules. */
export function findPlanRow(db: Db, id: string) {
  return db.select().from(plans).where(eq(plans.id, id)).get();
}

export function findPlanRowBySlug(db: Db, slug: string) {
  return db.select().from(plans).where(eq(plans.slug, slug)).get();
}

/**
 * Load a plan with its document. The stored JSON is re-validated against the
 * shared schema: a row written by an older build must never crash a reader.
 */
export function getPlanWithDoc(db: Db, id: string): PlanWithDoc | undefined {
  const row = findPlanRow(db, id);
  if (!row) return undefined;
  const data = db.select().from(planData).where(eq(planData.planId, id)).get();
  if (!data) return undefined;

  const parsed = PlanSchema.safeParse(JSON.parse(data.doc));
  if (!parsed.success) {
    // The row exists; its contents are unreadable. Callers answer NOT_FOUND
    // either way — a document we can't parse is a plan we can't serve — but
    // say so in the log, because from the outside this is indistinguishable
    // from a bad id, and it took a database dump to tell the two apart once.
    console.warn(
      `plan ${id}: stored document does not match the current schema —`,
      parsed.error.issues.slice(0, 3),
    );
    return undefined;
  }

  return { ...toSummary(row), doc: parsed.data, version: data.version };
}

/**
 * Plans visible to a user: their own plus any owned by their guilds, newest
 * first. Soft-deleted rows never appear.
 */
export function listPlansFor(
  db: Db,
  params: { userId: string; guildIds: string[] },
): PlanSummary[] {
  const mine = eq(plans.ownerId, params.userId);
  const where =
    params.guildIds.length > 0
      ? or(mine, inArray(plans.guildId, params.guildIds))
      : mine;

  return db
    .select()
    .from(plans)
    .where(and(where, isNull(plans.deletedAt)))
    .orderBy(desc(plans.updatedAt))
    .all()
    .map(toSummary);
}

/**
 * Replace the document.
 *
 * `expectedVersion` implements last-write-wins *with a check*: the editor
 * autosaves on a debounce, so a second tab could otherwise silently clobber
 * newer work (plan §15). Pass `undefined` to force.
 */
export function saveDoc(
  db: Db,
  params: { planId: string; doc: Plan; expectedVersion?: number },
): { version: number } {
  const at = nowSeconds();

  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(planData)
      .where(eq(planData.planId, params.planId))
      .get();
    if (!current) throw new Error(`No such plan: ${params.planId}`);

    if (
      params.expectedVersion !== undefined &&
      params.expectedVersion !== current.version
    ) {
      throw new PlanConflictError(current.version);
    }

    const version = current.version + 1;
    tx.update(planData)
      .set({
        doc: JSON.stringify(params.doc),
        // The version this server writes, not the one the client claimed. The
        // document has just been validated against `PlanSchema`, so it *is* the
        // current shape whatever number came in with it — and a stale number in
        // this column is what a future migration would read to decide what to
        // do with the blob.
        schemaVersion: SCHEMA_VERSION,
        version,
        updatedAt: at,
      })
      .where(eq(planData.planId, params.planId))
      .run();

    // Keep the relational columns in step so listings don't need the blob.
    tx.update(plans)
      .set({ title: params.doc.title, raid: params.doc.raid, updatedAt: at })
      .where(eq(plans.id, params.planId))
      .run();

    return { version };
  });
}

export function renamePlan(db: Db, planId: string, title: string): void {
  db.transaction((tx) => {
    tx.update(plans)
      .set({ title, updatedAt: nowSeconds() })
      .where(eq(plans.id, planId))
      .run();
    // The title lives in the document too — keep the two from drifting.
    const data = tx
      .select()
      .from(planData)
      .where(eq(planData.planId, planId))
      .get();
    if (!data) return;
    const parsed = PlanSchema.safeParse(JSON.parse(data.doc));
    if (!parsed.success) return;
    tx.update(planData)
      .set({ doc: JSON.stringify({ ...parsed.data, title }) })
      .where(eq(planData.planId, planId))
      .run();
  });
}

export function setVisibility(
  db: Db,
  planId: string,
  visibility: "private" | "unlisted" | "public",
): void {
  db.update(plans)
    .set({ visibility, updatedAt: nowSeconds() })
    .where(eq(plans.id, planId))
    .run();
}

/** Soft delete (plan §9). The row stays for recovery; access rules hide it. */
export function softDeletePlan(db: Db, planId: string): void {
  db.update(plans)
    .set({ deletedAt: nowSeconds() })
    .where(eq(plans.id, planId))
    .run();
}

/** Copy a plan (new id, new slug, fresh document) for the given owner. */
export function duplicatePlan(
  db: Db,
  params: { planId: string; ownerId: string },
): PlanWithDoc | undefined {
  const source = getPlanWithDoc(db, params.planId);
  if (!source) return undefined;

  const created = createPlan(db, {
    ownerId: params.ownerId,
    guildId: source.guildId,
    title: `${source.title} copy`,
    background: source.doc.background,
  });

  // Carry the content across under the *new* plan's identity.
  const doc: Plan = { ...source.doc, id: created.id, title: created.title };
  saveDoc(db, { planId: created.id, doc });
  return { ...created, doc, version: 2 };
}

/** Append a history snapshot (plan §5 `plan_versions`; read back in Phase 6). */
export function snapshotVersion(db: Db, planId: string, doc: Plan): void {
  db.insert(planVersions)
    .values({ id: randomUUID(), planId, doc: JSON.stringify(doc) })
    .run();
}
