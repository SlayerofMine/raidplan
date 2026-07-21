/**
 * The `DataTransfer` MIME types used when a palette tile is dragged onto the
 * canvas. Shared by the palette and the canvas drop handler so they agree on one
 * string per kind — a mismatch would make drops silently do nothing.
 */

/** Payload: an icon id. */
export const ICON_DATA_TYPE = "application/x-raidplan-icon";
/** Payload: a `ShapeKind`, or `"text"`/`"arrow"` for the non-shape primitives. */
export const SHAPE_DATA_TYPE = "application/x-raidplan-shape";
/** Payload: an attack definition id (plan §18.5). */
export const ATTACK_DATA_TYPE = "application/x-raidplan-attack";
