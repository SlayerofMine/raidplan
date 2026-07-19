import {
  getBackgroundSrc,
  getIconById,
  ICON_VIEWBOX,
  mechanicOps,
  resolveObjectState,
  tetherOps,
  type MechOp,
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

/** `[x0,y0,x1,y1,…]` → an SVG `points` string. */
function pointsToStr(points: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < points.length; i += 2) {
    out.push(`${points[i]},${points[i + 1]}`);
  }
  return out.join(" ");
}

/** The radial "danger" fill for hazard ops (voidzone), matching MechArtwork. */
function hazardDefs(gradientId: string, tint: string): string {
  return (
    `<defs><radialGradient id="${gradientId}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="${tint}" stop-opacity="0.53"/>` +
    `<stop offset="100%" stop-color="${tint}" stop-opacity="0.067"/>` +
    `</radialGradient></defs>`
  );
}

/** One shared mechanic draw-op → an SVG element, coloured by `tint`. */
function opToSvg(op: MechOp, tint: string, gradientId: string): string {
  const fill =
    op.fill === "none"
      ? `fill="none"`
      : op.fill === "soft"
        ? `fill="${tint}${FILL_ALPHA}"`
        : `fill="url(#${gradientId})"`;
  const stroke =
    op.stroke === "none"
      ? ""
      : ` stroke="${tint}" stroke-width="${op.strokeWidth}"` +
        (op.stroke === "dashed" ? ` stroke-dasharray="8 6"` : "");

  switch (op.t) {
    case "ellipse":
      return `<ellipse cx="${op.cx}" cy="${op.cy}" rx="${op.rx}" ry="${op.ry}" ${fill}${stroke}/>`;
    case "rect":
      return `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" ${fill}${stroke}/>`;
    case "path":
      return `<path d="${op.d}" ${fill}${stroke}/>`;
    case "polyline": {
      const pts = pointsToStr(op.points);
      return op.closed
        ? `<polygon points="${pts}" ${fill}${stroke}/>`
        : `<polyline points="${pts}" ${fill}${stroke}/>`;
    }
  }
}

/** Render a list of mechanic ops, injecting a hazard gradient if any op needs it. */
function opsToSvg(ops: MechOp[], tint: string, gradientId: string): string {
  const defs = ops.some((o) => o.fill === "hazard")
    ? hazardDefs(gradientId, tint)
    : "";
  return defs + ops.map((op) => opToSvg(op, tint, gradientId)).join("");
}

function renderObject(
  object: PlanObject,
  states: ReadonlyMap<string, ObjectState>,
  iconImages: Record<string, string>,
): string {
  const state = states.get(object.id);
  if (!state || !state.visible || state.opacity === 0) return "";

  const colour = object.base.tint ?? DEFAULT_TINT;
  const label = object.base.label;

  // A tether is drawn in absolute space from its endpoints' centres, not from
  // its own (degenerate) transform — mirrors TetherNode in the editor.
  if (object.type === "tether") {
    const from = object.fromId ? states.get(object.fromId) : undefined;
    const to = object.toId ? states.get(object.toId) : undefined;
    if (!from || !to || !from.visible || !to.visible) return "";
    const ops = tetherOps(
      { x: from.x + from.w / 2, y: from.y + from.h / 2 },
      { x: to.x + to.w / 2, y: to.y + to.h / 2 },
    );
    const alpha = state.opacity < 1 ? ` opacity="${state.opacity}"` : "";
    return `<g${alpha}>${opsToSvg(ops, colour, `hz-${object.id}`)}</g>`;
  }

  const { x, y, w, h, rotation, opacity } = state;
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
      // Every shape — generic and mechanic — is drawn from the shared draw-ops,
      // the same ones the Konva editor renders, so the preview can't drift.
      body = opsToSvg(
        mechanicOps(object.shape ?? "rect", w, h),
        colour,
        `hz-${object.id}`,
      );
      break;

    default: {
      // token / marker / image
      const icon = object.iconId ? getIconById(object.iconId) : undefined;
      const syncedImage = object.iconId ? iconImages[object.iconId] : undefined;
      if (icon) {
        // Inline the icon's markup rather than `<image href={icon.src}>`:
        // resvg drops <text> inside an embedded SVG image, which would render
        // every numbered raid marker as a blank disc. Scale from the icon's
        // own 64² space to the object's box.
        body +=
          `<g transform="scale(${w / ICON_VIEWBOX} ${h / ICON_VIEWBOX})">` +
          `${icon.body}</g>`;
      } else if (syncedImage) {
        // A synced WoW icon: a raster the caller already transcoded to PNG
        // (resvg renders PNG, not the WebP we store). Without this a reopened
        // plan's WoW tokens are blank in the Discord preview.
        body += `<image href="${syncedImage}" width="${w}" height="${h}"/>`;
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
export interface RenderOptions {
  /**
   * Overrides the background source.
   *
   * Needed for uploaded maps: their `assetId` is a *URL path* (`/uploads/x.png`)
   * that only a browser can fetch. resvg reads no network, so the caller inlines
   * the file as a data URI — otherwise the preview silently renders the tokens
   * on an empty floor, byte-identical to having no map at all.
   */
  backgroundSrc?: string | undefined;
  /**
   * Inline images for synced WoW icon tokens, keyed by icon id (PNG data URIs).
   *
   * Bundled tokens draw from their SVG markup, but synced icons live only as
   * files under `ICON_DIR`; resvg reads no network and doesn't decode WebP, so
   * the caller reads and transcodes them to PNG. Absent → those tokens don't
   * draw (the preview still renders everything else).
   */
  iconImages?: Record<string, string> | undefined;
}

export function renderPlanSvg(
  plan: Plan,
  stepIndex = 0,
  options: RenderOptions = {},
): string {
  const { width, height } = plan.background;
  const background =
    options.backgroundSrc ?? getBackgroundSrc(plan.background.assetId);
  const iconImages = options.iconImages ?? {};

  // Resolve every object once up front, so a tether can look up its endpoints'
  // states (not just its own) when it draws.
  const states = new Map<string, ObjectState>(
    plan.objects.map((object) => [
      object.id,
      resolveObjectState(object, plan.steps, stepIndex),
    ]),
  );

  const objects = plan.objects
    // Draw in z-order so the preview stacks like the board does.
    .slice()
    .sort((a, b) => a.base.z - b.base.z)
    .map((object) => renderObject(object, states, iconImages))
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
