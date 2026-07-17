import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { IconCatalogQuerySchema } from "@raidplan/shared";
import type { Viewer } from "../auth/access.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { createIconCatalogRepo } from "./catalogRepo.js";
import { isIconAdmin } from "./iconAdmin.js";
import { buildSyncDeps } from "./syncDeps.js";
import { startSync, type SyncDeps } from "./syncIcons.js";

/**
 * HTTP surface of the Icon Sync Service (plan §11.1 "Endpoints").
 *
 *  - `POST /api/admin/icons/sync`      admin-gated; kicks the job off async.
 *  - `GET  /api/admin/icons/sync/:id`  run status/progress.
 *  - `GET  /api/icons`                 the palette's paginated search feed.
 *  - `GET  /api/icons/resolve`         stable ids → current URLs (for render).
 *  - `GET  /icons/:filename`           serve a stored WebP (Caddy does this in
 *                                      prod; this keeps `pnpm dev` self-hosting).
 */
export interface IconRouteDeps {
  db: Db;
  config: Config;
  getUserId: (req: Request) => Promise<string | null> | string | null;
  viewerFor: (db: Db, userId: string) => Viewer;
  /**
   * Assemble the sync dependencies for a run. Injected so tests drive the
   * endpoint with in-memory fakes instead of the network, sharp and disk.
   */
  createSyncDeps?: (options: { source?: string }) => SyncDeps;
}

/** A stored icon filename is content-hash + size, chosen by us — never a path. */
const ICON_FILENAME = /^[0-9a-f]{16}_(?:56|112)\.webp$/;

/** Cap on ids per resolve call, so one request can't scan the whole catalog. */
const MAX_RESOLVE_IDS = 500;

export function createIconRoutes({
  db,
  config,
  getUserId,
  viewerFor,
  createSyncDeps = (options) => buildSyncDeps(db, config, options),
}: IconRouteDeps) {
  const app = new Hono();
  const repo = createIconCatalogRepo(db);

  const viewerOf = async (req: Request): Promise<Viewer | null> => {
    const userId = await getUserId(req);
    return userId ? viewerFor(db, userId) : null;
  };

  // --- admin: trigger + status ---------------------------------------------

  app.post("/api/admin/icons/sync", async (c) => {
    const userId = await getUserId(c.req.raw);
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    const viewer = viewerFor(db, userId);
    if (!isIconAdmin(viewer, config.iconAdminUserIds)) {
      return c.json({ error: "Not permitted." }, 403);
    }

    let body: { force?: unknown; source?: unknown } = {};
    try {
      body = await c.req.json();
    } catch {
      // No body is fine — an unforced sync from the configured source.
    }
    const force = body.force === true;
    const source = typeof body.source === "string" ? body.source : undefined;

    const { runId, done } = startSync(createSyncDeps({ source }), { force });
    // Fire-and-forget: the run row carries the outcome; never crash the process
    // on a rejected background job.
    void done.catch(() => {});
    return c.json({ runId }, 202);
  });

  app.get("/api/admin/icons/sync/:runId", async (c) => {
    const userId = await getUserId(c.req.raw);
    if (!userId) return c.json({ error: "Sign in first." }, 401);
    if (!isIconAdmin(viewerFor(db, userId), config.iconAdminUserIds)) {
      return c.json({ error: "Not permitted." }, 403);
    }
    const run = repo.getRun(c.req.param("runId"));
    if (!run) return c.json({ error: "No such run." }, 404);
    return c.json(run);
  });

  // --- palette search feed (guild-readable) --------------------------------

  app.get("/api/icons", async (c) => {
    if (!(await viewerOf(c.req.raw))) {
      return c.json({ error: "Sign in first." }, 401);
    }
    const parsed = IconCatalogQuerySchema.safeParse({
      query: c.req.query("query"),
      category: c.req.query("category"),
      cursor: c.req.query("cursor"),
    });
    if (!parsed.success) return c.json({ error: "Bad query." }, 400);

    return c.json(repo.search(parsed.data));
  });

  // --- id → URL resolution (open: icon art is public) ----------------------

  app.get("/api/icons/resolve", (c) => {
    const raw = c.req.query("ids") ?? "";
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_RESOLVE_IDS);
    return c.json({ items: repo.getByIds(ids) });
  });

  // --- serving -------------------------------------------------------------

  app.get("/icons/:filename", async (c) => {
    const filename = c.req.param("filename");
    // Our naming scheme only — this makes traversal impossible, not merely
    // filtered (cf. the uploads route).
    if (!ICON_FILENAME.test(filename)) return c.text("Not found", 404);
    try {
      const bytes = await readFile(join(config.ICON_DIR, filename));
      return c.body(new Uint8Array(bytes), 200, {
        "content-type": "image/webp",
        "x-content-type-options": "nosniff",
        "cache-control": "public, max-age=31536000, immutable",
      });
    } catch {
      return c.text("Not found", 404);
    }
  });

  return app;
}
