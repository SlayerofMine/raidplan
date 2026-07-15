import {
  getBackgroundSrc,
  getIconById,
  ICON_VIEWBOX,
  resolveObjectState,
  type ObjectState,
  type Plan,
  type PlanObject,
} from "@raidplan/shared";

/**
 * Render a plan step to an SVG string, for the Discord link preview (plan §4.7).
 *
 * This is a **second renderer**: the editor and viewer draw with Konva in a
 * browser, but a crawler's preview has to be produced server-side with no DOM
 * and no canvas. What keeps the two honest is that both resolve their state
 * with the *same* `resolveObjectState` from `shared` — the maths that decides
 * where a token sits on step N isn't duplicated, only the drawing is.
 *
 * SVG rather than satori: our icons and maps already *are* SVG data URIs, so
 * composing them is string work. satori is for laying out text and flexbox,
 * which isn't what a raid board is.
 */
const DEFAULT_TINT = "#4f9dff";
const FILL_ALPHA = "33";
const LABEL_FONT_SIZE = 14;

/** XML-escape text that came from a user (labels, titles). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderObject(object: PlanObject, state: ObjectState): string {
  if (!state.visible || state.opacity === 0) return "";

  const { x, y, w, h, rotation, opacity } = state;
  const colour = object.base.tint ?? DEFAULT_TINT;
  const label = object.base.label;
  // Rotate about the object's own origin, matching Konva (plan §2.6 / marquee).
  const transform = `translate(${x} ${y})${rotation ? ` rotate(${rotation})` : ""}`;

  let body = "";
  switch (object.type) {
    case "text":
      body =
        `<text x="${w / 2}" y="${h / 2}" fill="${colour}" font-size="${Math.max(10, h * 0.6)}" ` +
        `font-family="sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central">` +
        `${escapeXml(label ?? "Text")}</text>`;
      break;

    case "arrow":
      body =
        `<line x1="0" y1="${h / 2}" x2="${w - 16}" y2="${h / 2}" stroke="${colour}" stroke-width="6"/>` +
        `<polygon points="${w - 16},${h / 2 - 8} ${w},${h / 2} ${w - 16},${h / 2 + 8}" fill="${colour}"/>`;
      break;

    case "shape":
      if (object.shape === "circle") {
        body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${colour}${FILL_ALPHA}" stroke="${colour}" stroke-width="3"/>`;
      } else if (object.shape === "cone") {
        // A 60° wedge opening upward from the bottom-centre, as Konva draws it.
        const half = (60 * Math.PI) / 180 / 2;
        const cx = w / 2;
        const left = cx - Math.sin(half) * h;
        const right = cx + Math.sin(half) * h;
        const tipY = h - Math.cos(half) * h;
        body = `<polygon points="${cx},${h} ${left},${tipY} ${right},${tipY}" fill="${colour}${FILL_ALPHA}" stroke="${colour}" stroke-width="3"/>`;
      } else {
        body = `<rect width="${w}" height="${h}" fill="${colour}${FILL_ALPHA}" stroke="${colour}" stroke-width="3"/>`;
      }
      break;

    default: {
      // token / marker / image
      const icon = object.iconId ? getIconById(object.iconId) : undefined;
      if (icon) {
        // Inline the icon's markup rather than `<image href={icon.src}>`:
        // resvg drops <text> inside an embedded SVG image, which would render
        // every numbered raid marker as a blank disc. Scale from the icon's
        // own 64² space to the object's box.
        body +=
          `<g transform="scale(${w / ICON_VIEWBOX} ${h / ICON_VIEWBOX})">` +
          `${icon.body}</g>`;
      }
      if (object.base.tint) {
        body += `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2 - 2}" fill="none" stroke="${object.base.tint}" stroke-width="4"/>`;
      }
    }
  }

  // Labels sit under tokens, above arrows, centred in shapes — mirroring
  // `objectLabel.ts` in the web app.
  if (label && object.type !== "text") {
    const labelY =
      object.type === "arrow"
        ? -6
        : object.type === "shape"
          ? h / 2
          : h + LABEL_FONT_SIZE;
    body +=
      `<text x="${w / 2}" y="${labelY}" fill="#e6e6e6" font-size="${LABEL_FONT_SIZE}" ` +
      `font-family="sans-serif" text-anchor="middle">${escapeXml(label)}</text>`;
  }

  const alpha = opacity < 1 ? ` opacity="${opacity}"` : "";
  return `<g transform="${transform}"${alpha}>${body}</g>`;
}

/**
 * Compose the plan's step into one SVG document.
 *
 * `stepIndex` follows the same convention as the editor: -1 is the base layout,
 * 0..n a step. The plan calls for a render of "step 1" (§9), i.e. index 0 when
 * the plan has steps.
 */
export function renderPlanSvg(plan: Plan, stepIndex = 0): string {
  const { width, height } = plan.background;
  const background = getBackgroundSrc(plan.background.assetId);

  const objects = plan.objects
    // Draw in z-order so the preview stacks like the board does.
    .slice()
    .sort((a, b) => a.base.z - b.base.z)
    .map((object) =>
      renderObject(object, resolveObjectState(object, plan.steps, stepIndex)),
    )
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="#0f141c"/>` +
    (background
      ? `<image href="${background}" width="${width}" height="${height}"/>`
      : "") +
    objects +
    `</svg>`
  );
}
