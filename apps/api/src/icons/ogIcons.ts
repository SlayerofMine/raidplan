import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getIconById, type Plan } from "@raidplan/shared";
import type { IconCatalogRepo } from "./catalogRepo.js";

/**
 * Resolve a plan's **synced** WoW icon tokens to inline PNG data URIs for the
 * Open Graph preview (plan §11.1 / §4.7).
 *
 * The OG image is rasterised by resvg, which reads no network and — verified —
 * does **not** decode embedded WebP, only PNG/JPEG. So for each synced token we
 * read its stored 112px WebP from `ICON_DIR` and transcode it to PNG with sharp.
 * Bundled tokens are drawn from their own SVG markup by the renderer and are
 * skipped here (`getIconById` finds them). A missing or unreadable file is
 * skipped rather than failing the whole preview.
 */
export async function inlineSyncedIconsForOg(
  plan: Plan,
  repo: IconCatalogRepo,
  iconDir: string,
): Promise<Record<string, string>> {
  const ids = [
    ...new Set(
      plan.objects
        .map((o) => o.iconId)
        .filter((id): id is string => Boolean(id) && !getIconById(id!)),
    ),
  ];
  if (ids.length === 0) return {};

  const { default: sharp } = await import("sharp");
  const images: Record<string, string> = {};

  await Promise.all(
    repo.getByIds(ids).map(async (entry) => {
      try {
        const bytes = await readFile(join(iconDir, basename(entry.url112)));
        const png = await sharp(bytes).png().toBuffer();
        images[entry.id] = `data:image/png;base64,${png.toString("base64")}`;
      } catch {
        // Missing/corrupt file: leave this token undrawn, don't 500 the preview.
      }
    }),
  );

  return images;
}
