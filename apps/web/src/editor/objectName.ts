import {
  getIconById,
  type ObjectType,
  type PlanObject,
} from "@raidplan/shared";

/**
 * The human-friendly name for an object in editor lists (Properties, Animation
 * panel, Timeline). Deliberately **never** the internal object id.
 *
 * Fallback order:
 *  1. `base.name`  — the author's explicit identifier;
 *  2. `base.label` — the on-canvas text, a reasonable stand-in;
 *  3. the bundled icon's manifest name, for icon-backed tokens;
 *  4. the object's type ("Token", "Shape", …) as a last resort.
 */

const TYPE_LABELS: Record<ObjectType, string> = {
  token: "Token",
  marker: "Marker",
  shape: "Shape",
  text: "Text",
  arrow: "Arrow",
  image: "Image",
  tether: "Tether",
};

export function objectDisplayName(object: PlanObject | undefined): string {
  if (!object) return "Object";

  const name = object.base.name?.trim();
  if (name) return name;

  const label = object.base.label?.trim();
  if (label) return label;

  if (object.iconId) {
    const icon = getIconById(object.iconId);
    if (icon) return icon.name;
  }

  return TYPE_LABELS[object.type] ?? "Object";
}
