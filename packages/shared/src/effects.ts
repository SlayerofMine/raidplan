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

/**
 * When an animation starts, relative to the step timeline (plan §7).
 *
 * The first three chain off the step's start and are compiled into its
 * timeline. `onClick` and `onCollision` are **deferred**: they sit outside that
 * timeline and are fired on demand during playback (see `anim/stepTimeline.ts`
 * `isDeferredTrigger`) — a click on the object, or it overlapping one of the
 * objects listed in the animation's `collideWith`.
 */
export const ANIM_TRIGGERS = [
  "onEnter",
  "withPrevious",
  "afterPrevious",
  "onClick",
  "onCollision",
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
  /**
   * A tether draws a line between two *other* objects (`fromId`/`toId` on the
   * plan object). Its geometry is derived from its endpoints, not from its own
   * transform — see `tetherOps` in `mechanics.ts`.
   */
  "tether",
  /**
   * A **hole in an attack definition**, filled by one of the using plan's own
   * objects (plan §18.14). It draws nothing itself: at expansion every
   * reference to it — a tether endpoint, a collision target, an animation
   * target — becomes a reference to the object the plan put there, which is how
   * an attack can tether the boss to a player it could never have known about.
   */
  "placeholder",
] as const;
export const ObjectTypeSchema = z.enum(OBJECT_TYPES);
export type ObjectType = z.infer<typeof ObjectTypeSchema>;

/**
 * Which primitive a `type: "shape"` object draws (plan §2.4). Optional on the
 * object, so it only carries meaning for shapes and older documents that
 * predate primitives stay valid without a migration.
 *
 * `rect`/`circle` are generic zones; the rest are WoW **mechanics** with a
 * distinguishing visual language (`mechanics.ts`): `cone` (frontal), `line`
 * (beam/frontal), `soak` (stack-here target), `voidzone` (hazard puddle),
 * `pickup` (collectible). Extending this list is additive — old plans stay valid.
 */
export const SHAPE_KINDS = [
  "rect",
  "circle",
  "cone",
  "line",
  "soak",
  "voidzone",
  "pickup",
] as const;
export const ShapeKindSchema = z.enum(SHAPE_KINDS);
export type ShapeKind = z.infer<typeof ShapeKindSchema>;

/** Plan-level visibility for access control (plan §5 persistence / §9). */
export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export const VisibilitySchema = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof VisibilitySchema>;
