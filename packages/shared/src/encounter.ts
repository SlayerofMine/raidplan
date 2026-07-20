import { z } from "zod";
import {
  BackgroundSchema,
  makeEmptyPlan,
  PlanObjectSchema,
  StepSchema,
  type Plan,
} from "./plan.js";
import { BACKGROUNDS, toBackground } from "./assets/backgrounds.js";

/**
 * Encounter presets (plan §17, stage 1).
 *
 * An **encounter** is an admin-authored starting point: a background plus any
 * pre-placed objects and steps. Picking a raid + encounter in the new-plan flow
 * seeds a fresh plan from its preset, so a planner starts on the right map
 * instead of a blank arena.
 *
 * A preset is deliberately a *slice of a Plan* (`background`/`objects`/`steps`),
 * reusing the very schemas the document is built from — the seed is just a Plan
 * template, and `makePlanFromPreset` stamps it into a real document. Keeping it
 * here (not in the editor or the API) means web and api agree on what a preset
 * is and how it becomes a plan.
 */

/** The seed content of an encounter — the part that becomes a new plan's body. */
export const EncounterPresetSchema = z.object({
  background: BackgroundSchema,
  /** Pre-placed objects, if the encounter ships with any. */
  objects: z.array(PlanObjectSchema).default([]),
  /** Pre-authored steps, if any. */
  steps: z.array(StepSchema).default([]),
});
export type EncounterPreset = z.infer<typeof EncounterPresetSchema>;

/**
 * What the encounter selector needs: enough to group by raid and show a label,
 * plus the background for a preview. The heavy preset body is fetched
 * server-side when a plan is actually created, never shipped just to fill a
 * dropdown.
 */
export const EncounterSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  raid: z.string(),
  name: z.string().min(1),
  background: BackgroundSchema,
});
export type EncounterSummary = z.infer<typeof EncounterSummarySchema>;

/**
 * A code-defined encounter used to seed the registry (admin CRUD replaces/
 * extends these later). Identity is the `slug`, so re-seeding is idempotent.
 */
export interface DefaultEncounter {
  slug: string;
  raid: string;
  name: string;
  preset: EncounterPreset;
}

/**
 * Build a fresh plan document from an encounter preset.
 *
 * Uses {@link makeEmptyPlan} for the identity/defaults, then overlays the
 * preset's body. The preset's objects/steps are copied verbatim — their ids
 * only need to be unique within one document, so two plans seeded from the same
 * encounter don't collide.
 */
export function makePlanFromPreset(params: {
  id: string;
  title?: string;
  raid?: string;
  preset: EncounterPreset;
}): Plan {
  const base = makeEmptyPlan({
    id: params.id,
    ...(params.title !== undefined ? { title: params.title } : {}),
    ...(params.raid !== undefined ? { raid: params.raid } : {}),
    background: params.preset.background,
  });
  return {
    ...base,
    objects: params.preset.objects,
    steps: params.preset.steps,
  };
}

/**
 * The starter registry: today's three bundled maps re-expressed as encounters
 * under a "Sandbox" raid. This keeps the new-plan flow working before any
 * admin-authored encounter exists — and, using bundled backgrounds with no
 * pre-placed icon tokens, it never depends on an icon sync having run.
 */
export const DEFAULT_ENCOUNTERS: readonly DefaultEncounter[] = BACKGROUNDS.map(
  (bg) => ({
    slug: `sandbox-${bg.assetId}`,
    raid: "Sandbox",
    name: bg.name,
    preset: { background: toBackground(bg), objects: [], steps: [] },
  }),
);
