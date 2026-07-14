import { z } from "zod";

/**
 * A 2D transform in the background's **native pixel space** (see plan §5,
 * "Coordinate system"). All positions are resolution-independent; the Konva
 * Stage is scaled to fit the container at render time.
 */
export const TransformSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  /** Width in native pixels. Non-negative; zero is allowed for degenerate/hidden nodes. */
  w: z.number().finite().nonnegative(),
  /** Height in native pixels. */
  h: z.number().finite().nonnegative(),
  /** Rotation in degrees (Konva convention), clockwise. */
  rotation: z.number().finite(),
});

export type Transform = z.infer<typeof TransformSchema>;

/** A single point in native pixel space (used for motion paths). */
export const PointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export type Point = z.infer<typeof PointSchema>;
