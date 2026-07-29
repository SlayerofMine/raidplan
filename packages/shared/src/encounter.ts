import { z } from "zod";
import {
  BackgroundSchema,
  makeEmptyPlan,
  PlanObjectSchema,
  SlideSchema,
  type Plan,
} from "./plan.js";
import { normalizeSlides, seedState } from "./resolve.js";
import { BACKGROUNDS, toBackground } from "./assets/backgrounds.js";

/**
 * Encounter presets (plan §17, stage 1).
 *
 * An **encounter** is an admin-authored starting point: a background plus any
 * pre-placed objects and slides. Picking a raid + encounter in the new-plan flow
 * seeds a fresh plan from its preset, so a planner starts on the right map
 * instead of a blank arena.
 *
 * A preset is deliberately a *slice of a Plan* (`background`/`objects`/`slides`),
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
  /**
   * Pre-authored slides, if any. A preset with none seeds the plan's own opening
   * slide instead, so an encounter is free to be nothing but a background.
   */
  slides: z.array(SlideSchema).default([]),
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
 * preset's body. The preset's objects/slides are copied verbatim — their ids
 * only need to be unique within one document, so two plans seeded from the same
 * encounter don't collide.
 *
 * A preset that lists objects but no slide states for them is taken to mean
 * "these are the encounter's furniture": they are placed on the **opening
 * slide**, at their authored transform. Only there — where else a boss stands is
 * the plan's story to tell, not the encounter's.
 *
 * A preset with **no slides** keeps the empty plan's opening slide, rather than
 * being copied over it. Every bundled encounter is exactly that — a background
 * and nothing else — so getting this wrong produces a plan with no slides at
 * all, which `PlanSchema` refuses to parse and no editor can open.
 *
 * The single place a plan is built from a preset, for that reason: the API's
 * `createPlan` delegates here rather than overlaying the fields itself.
 */
export function makePlanFromPreset(params: {
  id: string;
  title?: string;
  raid?: string;
  /** Which encounter seeded this plan (plan §17). */
  encounterId?: string;
  preset: EncounterPreset;
}): Plan {
  const base = makeEmptyPlan({
    id: params.id,
    ...(params.title !== undefined ? { title: params.title } : {}),
    ...(params.raid !== undefined ? { raid: params.raid } : {}),
    ...(params.encounterId !== undefined
      ? { encounterId: params.encounterId }
      : {}),
    background: params.preset.background,
  });
  const authored =
    params.preset.slides.length > 0 ? params.preset.slides : base.slides;
  const slides = normalizeSlides(params.preset.objects, authored);
  const opening = slides[0];
  if (opening) {
    const missing = params.preset.objects.filter(
      (object) => !slides.some((slide) => slide.states[object.id]),
    );
    if (missing.length > 0) {
      slides[0] = {
        ...opening,
        states: {
          ...opening.states,
          ...Object.fromEntries(
            missing.map((object) => [object.id, seedState(object)]),
          ),
        },
      };
    }
  }
  return { ...base, objects: params.preset.objects, slides };
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
    preset: { background: toBackground(bg), objects: [], slides: [] },
  }),
);
