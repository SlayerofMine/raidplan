import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Plan, type PlanObject } from "@raidplan/shared";
import type { Db } from "../../src/db/client.js";
import { createTestDb } from "../../src/db/testDb.js";
import { renderOgImage } from "../../src/og/renderOgImage.js";
import { createIconCatalogRepo } from "../../src/icons/catalogRepo.js";
import { inlineSyncedIconsForOg } from "../../src/icons/ogIcons.js";

const SYNCED = "spell_fire_fireball02";

const token = (iconId: string): PlanObject => ({
  id: "o1",
  type: "token",
  iconId,
  base: {
    x: 150,
    y: 100,
    w: 100,
    h: 100,
    rotation: 0,
    opacity: 1,
    z: 0,
    visible: true,
  },
});

const plan = (objects: PlanObject[]): Plan => ({
  id: "p",
  title: "T",
  raid: "",
  background: { assetId: "no-such-bg", width: 400, height: 300 },
  objects,
  steps: [],
  schemaVersion: SCHEMA_VERSION,
});

/** A solid-red WebP, as the sync would have stored it. */
async function redWebp(): Promise<Uint8Array> {
  const buf = await sharp({
    create: {
      width: 112,
      height: 112,
      channels: 4,
      background: { r: 220, g: 30, b: 30, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();
  return new Uint8Array(buf);
}

describe("inlineSyncedIconsForOg", () => {
  let db: Db;
  let close: () => void;
  let iconDir: string;
  let repo: ReturnType<typeof createIconCatalogRepo>;

  beforeEach(async () => {
    ({ db, close } = createTestDb());
    repo = createIconCatalogRepo(db);
    iconDir = await mkdtemp(join(tmpdir(), "ogicons-"));
  });
  afterEach(() => close());

  async function seedSynced(filename: string, write = true): Promise<void> {
    repo.upsertIcon({
      id: SYNCED,
      fileDataId: null,
      contentHash: "hash",
      url56: `/icons/${filename.replace("_112", "_56")}`,
      url112: `/icons/${filename}`,
      source: "pack",
      firstSeenBuild: "12.1.0",
    });
    if (write) await writeFile(join(iconDir, filename), await redWebp());
  }

  it("transcodes the stored WebP to a PNG data URI (resvg can't read WebP)", async () => {
    await seedSynced("redicon_112.webp");
    const images = await inlineSyncedIconsForOg(
      plan([token(SYNCED)]),
      repo,
      iconDir,
    );
    expect(images[SYNCED]).toMatch(/^data:image\/png;base64,/);
  });

  it("skips a token whose file is missing without failing", async () => {
    await seedSynced("gone_112.webp", /* write */ false);
    const images = await inlineSyncedIconsForOg(
      plan([token(SYNCED)]),
      repo,
      iconDir,
    );
    expect(images).toEqual({});
  });

  it("ignores bundled tokens (they draw from their own markup)", async () => {
    const images = await inlineSyncedIconsForOg(
      plan([token("marker-1")]),
      repo,
      iconDir,
    );
    expect(images).toEqual({});
  });

  it("renders a non-blank OG image for a synced token end-to-end", async () => {
    // The whole point: reopening a plan with a WoW token must show it in the
    // Discord preview, not a blank floor.
    await seedSynced("redicon_112.webp");
    const p = plan([token(SYNCED)]);

    const images = await inlineSyncedIconsForOg(p, repo, iconDir);
    const png = renderOgImage(p, -1, { iconImages: images });

    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let red = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i]! > 150 && data[i + 1]! < 100 && data[i + 2]! < 100) red++;
    }
    expect(red).toBeGreaterThan(0);
  });
});
