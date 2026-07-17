/**
 * The `DataTransfer` MIME type used when an icon tile is dragged onto the
 * canvas. Shared by the palette (both the bundled tiles and the WoW grid) and
 * the canvas drop handler so they agree on one string — a mismatch would make
 * drops silently do nothing.
 */
export const ICON_DATA_TYPE = "application/x-raidplan-icon";
