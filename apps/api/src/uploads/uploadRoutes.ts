import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { assets } from "../db/schema.js";
import {
  MAX_UPLOAD_BYTES,
  readImageSize,
  validateUpload,
} from "./validateUpload.js";

/**
 * Custom background uploads (plan §4.8).
 *
 * Three rules, because this is the app's most exposed surface:
 *
 *  1. **Authenticated only.** Anonymous writes to our disk are not a feature.
 *  2. **The bytes decide** what a file is — never its name or Content-Type
 *     (see `validateUpload`). SVG is rejected outright: script-bearing.
 *  3. **We choose the filename.** A uuid plus an extension *we* derived, so a
 *     name like `../../etc/passwd` or `x.html` can't escape the directory or
 *     pick its own content type.
 */
export interface UploadDeps {
  db: Db;
  config: Config;
  getUserId: (req: Request) => Promise<string | null> | string | null;
}

export function createUploadRoutes({ db, config, getUserId }: UploadDeps) {
  const app = new Hono();

  app.post("/api/upload", async (c) => {
    const userId = await getUserId(c.req.raw);
    if (!userId) return c.json({ error: "Sign in first." }, 401);

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "Expected a multipart upload." }, 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "No file was uploaded." }, 400);
    }
    // Check the declared size before reading, so an oversized body isn't
    // pulled into memory just to be rejected.
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "That image is too large." }, 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validateUpload(bytes);
    if (!check.ok) return c.json({ error: check.error }, 400);

    const id = randomUUID();
    // Our name, our extension — never the client's.
    const filename = `${id}.${check.info.extension}`;
    await mkdir(config.UPLOAD_DIR, { recursive: true });
    await writeFile(join(config.UPLOAD_DIR, filename), bytes);

    const size = readImageSize(bytes);
    const url = `/uploads/${filename}`;
    db.insert(assets)
      .values({
        id,
        ownerId: userId,
        kind: "background",
        url,
        // 0 means "not measured" for formats we don't parse; the editor reads
        // the real size from the image once it loads.
        width: size?.width ?? 0,
        height: size?.height ?? 0,
      })
      .run();

    return c.json(
      { id, url, width: size?.width ?? 0, height: size?.height ?? 0 },
      201,
    );
  });

  /**
   * Serve an upload.
   *
   * Looked up **via the database**, not by joining the request path onto a
   * directory — that's what makes path traversal impossible rather than merely
   * filtered. The content type is derived from the extension *we* assigned at
   * upload (never the client's), and `nosniff` stops a browser second-guessing
   * it and executing what it finds.
   *
   * In production Caddy can serve this directory directly; this keeps `pnpm dev`
   * working without one.
   */
  app.get("/uploads/:filename", async (c) => {
    const filename = c.req.param("filename");
    const asset = db
      .select()
      .from(assets)
      .where(eq(assets.url, `/uploads/${filename}`))
      .get();
    if (!asset) return c.text("Not found", 404);

    try {
      const bytes = await readFile(join(config.UPLOAD_DIR, filename));
      const extension = filename.split(".").pop() ?? "";
      const mime =
        {
          png: "image/png",
          jpg: "image/jpeg",
          webp: "image/webp",
          gif: "image/gif",
        }[extension] ?? "application/octet-stream";
      return c.body(new Uint8Array(bytes), 200, {
        "content-type": mime,
        "x-content-type-options": "nosniff",
        "cache-control": "public, max-age=31536000, immutable",
      });
    } catch {
      return c.text("Not found", 404);
    }
  });

  return app;
}
