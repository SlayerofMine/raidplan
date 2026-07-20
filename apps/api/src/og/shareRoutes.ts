import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Hono } from "hono";
import { expandPlan, isUploadedAsset, type Plan } from "@raidplan/shared";
import { canView } from "../auth/access.js";
import { attackDefsForPlan } from "../attacks/attacksRepo.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { createIconCatalogRepo } from "../icons/catalogRepo.js";
import { inlineSyncedIconsForOg } from "../icons/ogIcons.js";
import { findPlanRowBySlug, getPlanWithDoc, toAcl } from "../plans/planRepo.js";
import { isValidSlug } from "../plans/slug.js";
import { escapeXml } from "./renderPlanSvg.js";
import { renderOgImage } from "./renderOgImage.js";

/**
 * The public share surface (plan §9 "Plain Hono routes", §4.6/§4.7).
 *
 * `GET /p/:slug` exists as a *server* route because Discord's crawler doesn't
 * run JavaScript: fetching the SPA's index.html would show it an empty
 * `<div id="root">` and produce a bare link. So we answer crawlers with real
 * Open Graph meta, and hand real browsers straight on to the app.
 */
export interface ShareDeps {
  db: Db;
  config: Config;
  /** Resolve the caller, so a private plan isn't unfurled to strangers. */
  getUserId?: (req: Request) => Promise<string | null> | string | null;
  viewerFor: (
    db: Db,
    userId: string,
  ) => { userId: string; roles: Record<string, "viewer" | "editor" | "owner"> };
}

/** How long a preview may be cached. Long enough to help, short enough to refresh. */
const OG_CACHE_SECONDS = 300;

export function createShareRoutes({
  db,
  config,
  getUserId,
  viewerFor,
}: ShareDeps) {
  const app = new Hono();
  const iconRepo = createIconCatalogRepo(db);

  /** Load a plan by slug, applying the access rules. */
  const loadShared = async (
    slug: string,
    req: Request,
  ): Promise<Plan | null> => {
    if (!isValidSlug(slug)) return null;
    const row = findPlanRowBySlug(db, slug);
    if (!row) return null;

    const userId = getUserId ? await getUserId(req) : null;
    const viewer = userId ? viewerFor(db, userId) : null;
    // `unlisted`/`public` need no session; `private` does (plan §10).
    if (!canView(toAcl(row), viewer)) return null;

    return getPlanWithDoc(db, row.id)?.doc ?? null;
  };

  app.get("/p/:slug/og.png", async (c) => {
    const raw = await loadShared(c.req.param("slug"), c.req.raw);
    if (!raw) return c.text("Not found", 404);

    // Stamp any attacks into concrete objects so the preview shows them too
    // (plan §17). A no-attack plan passes straight through.
    const plan = expandPlan(raw, attackDefsForPlan(db, raw));

    // "Step 1" is index 0; a plan with no steps previews its base layout.
    const png = renderOgImage(plan, plan.steps.length > 0 ? 0 : -1, {
      backgroundSrc: await inlineUploadedBackground(
        plan.background.assetId,
        config.UPLOAD_DIR,
      ),
      // Synced WoW tokens live as files under ICON_DIR; inline them or they're
      // blank in the preview (see inlineSyncedIconsForOg).
      iconImages: await inlineSyncedIconsForOg(plan, iconRepo, config.ICON_DIR),
    });
    return c.body(new Uint8Array(png), 200, {
      "content-type": "image/png",
      "cache-control": `public, max-age=${OG_CACHE_SECONDS}`,
    });
  });

  app.get("/p/:slug", async (c) => {
    const slug = c.req.param("slug");
    const plan = await loadShared(slug, c.req.raw);
    if (!plan) return c.html(notFoundHtml(), 404);

    return c.html(sharePageHtml(plan, slug, config.BASE_URL), 200, {
      // Never let a proxy serve one guild's private plan to another visitor.
      "cache-control": "private, no-cache",
    });
  });

  return app;
}

/** Content types we store, keyed by the extension the upload route assigned. */
const UPLOAD_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Inline an uploaded background as a data URI, or `undefined` for anything else.
 *
 * A bundled map's `assetId` already resolves to inline artwork, but an upload's
 * is a URL path — and resvg reads no network, so it would silently draw nothing
 * and the preview would show tokens on an empty floor. Reading the file is the
 * only way it can appear.
 *
 * `basename` is belt-and-braces: the id comes from our own upload route, but a
 * path assembled from a stored string should never be able to leave the
 * uploads directory.
 */
export async function inlineUploadedBackground(
  assetId: string,
  uploadDir: string,
): Promise<string | undefined> {
  if (!isUploadedAsset(assetId)) return undefined;
  const filename = basename(assetId);
  const mime = UPLOAD_MIME[filename.split(".").pop() ?? ""];
  if (!mime) return undefined;
  try {
    const bytes = await readFile(join(uploadDir, filename));
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    // A missing file shouldn't 500 the preview — draw the plan without it.
    return undefined;
  }
}

/** A one-line summary for the unfurl card. */
export function planDescription(plan: Plan): string {
  const steps = plan.steps.length;
  const objects = plan.objects.length;
  const parts = [
    `${steps} ${steps === 1 ? "step" : "steps"}`,
    `${objects} ${objects === 1 ? "object" : "objects"}`,
  ];
  if (plan.raid) parts.unshift(plan.raid);
  return parts.join(" · ");
}

/**
 * The share page: Open Graph meta for crawlers, and a redirect into the SPA for
 * humans.
 *
 * The redirect is client-side rather than a 302 so the crawler still parses the
 * meta tags — a 302 would send Discord to the SPA shell, which tells it nothing.
 */
export function sharePageHtml(
  plan: Plan,
  slug: string,
  baseUrl: string,
): string {
  const url = `${baseUrl}/p/${slug}`;
  const title = escapeHtml(plan.title || "RaidPlans");
  const description = escapeHtml(planDescription(plan));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title} — RaidPlans</title>
    <meta name="description" content="${description}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="RaidPlans" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(`${url}/og.png`)}" />
    <meta property="og:image:type" content="image/png" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${escapeHtml(`${url}/og.png`)}" />

    <meta name="theme-color" content="#0b0d12" />
    <!-- Humans get the app; crawlers stop at the meta above. -->
    <script>window.location.replace(${JSON.stringify(`/view/${slug}`)});</script>
  </head>
  <body style="margin:0;background:#0b0d12;color:#e6e6e6;font-family:system-ui,sans-serif">
    <p style="padding:2rem">
      <a href="/view/${escapeHtml(slug)}" style="color:#4f9dff">Open ${title} →</a>
    </p>
  </body>
</html>`;
}

function notFoundHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Not found — RaidPlans</title></head>
  <body style="margin:0;background:#0b0d12;color:#e6e6e6;font-family:system-ui,sans-serif">
    <p style="padding:2rem">This plan doesn't exist, or isn't shared with you.</p>
  </body>
</html>`;
}

/** Escape for an HTML attribute or text node. Reuses the SVG/XML escaper. */
const escapeHtml = escapeXml;
