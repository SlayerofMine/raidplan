import type { ObjectType } from "@raidplan/shared";

/** Font size (native px) for a standalone object label. */
export const LABEL_FONT_SIZE = 14;
export const LABEL_COLOUR = "#e6e6e6";
/** Gap between the object's box and a label placed outside it. */
const LABEL_GAP = 4;

/**
 * Where an object's `label` is drawn, relative to its own box (plan §5: `label`
 * is a property of *every* object, not just text).
 *
 * The placement differs by type so the label never fights the artwork:
 *  - **token/marker/image** — underneath, the way a player name sits under a
 *    raid token; centring it would cover the icon.
 *  - **shape** — centred inside, since shapes are big translucent areas
 *    ("stack here", "bait"), and the fill is see-through.
 *  - **arrow** — above the line, which is only a few px tall.
 *  - **text** — `null`: a text object *is* its label, so it has no separate one.
 */
export interface LabelLayout {
  /** Y offset in the object's local space. */
  y: number;
  /** Box height the text is aligned within. */
  height: number;
  verticalAlign: "top" | "middle";
}

export function labelLayout(type: ObjectType, h: number): LabelLayout | null {
  switch (type) {
    case "text":
      return null;
    // A placeholder is a ring with its name in the middle, like a shape: the
    // name *is* what the plan will be asked for, so it must read at a glance.
    case "shape":
    case "placeholder":
      return { y: 0, height: h, verticalAlign: "middle" };
    case "arrow":
      return {
        y: -(LABEL_FONT_SIZE + LABEL_GAP),
        height: LABEL_FONT_SIZE + LABEL_GAP,
        verticalAlign: "top",
      };
    // token / marker / image
    default:
      return {
        y: h + LABEL_GAP,
        height: LABEL_FONT_SIZE + LABEL_GAP,
        verticalAlign: "top",
      };
  }
}
