import { z } from "zod";

/**
 * Animation vocabulary (plan §5 data model / §7 animation design).
 *
 * These `as const` tuples are the single source of truth for the enums: zod
 * schemas derive from them and UI code can iterate them for pickers, so adding
 * an effect is a one-line change that stays type-safe end to end.
 */

/** The kind of animation — mirrors PowerPoint's four families. */
export const ANIM_KINDS = ["entrance", "exit", "emphasis", "motion"] as const;
export const AnimKindSchema = z.enum(ANIM_KINDS);
export type AnimKind = z.infer<typeof AnimKindSchema>;

/** The concrete visual effect applied. */
export const ANIM_EFFECTS = [
  "appear",
  "disappear",
  "fade",
  "fly",
  "move",
  "scale",
  "pulse",
  "blink",
] as const;
export const AnimEffectSchema = z.enum(ANIM_EFFECTS);
export type AnimEffect = z.infer<typeof AnimEffectSchema>;

/** When an animation starts, relative to the step timeline (plan §7). */
export const ANIM_TRIGGERS = [
  "onEnter",
  "withPrevious",
  "afterPrevious",
  "onClick",
] as const;
export const AnimTriggerSchema = z.enum(ANIM_TRIGGERS);
export type AnimTrigger = z.infer<typeof AnimTriggerSchema>;

/** The shape/primitive kind of a plan object. */
export const OBJECT_TYPES = [
  "token",
  "marker",
  "shape",
  "text",
  "arrow",
  "image",
] as const;
export const ObjectTypeSchema = z.enum(OBJECT_TYPES);
export type ObjectType = z.infer<typeof ObjectTypeSchema>;

/** Plan-level visibility for access control (plan §5 persistence / §9). */
export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export const VisibilitySchema = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof VisibilitySchema>;
