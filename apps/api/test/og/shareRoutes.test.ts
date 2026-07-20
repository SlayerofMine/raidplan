import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Plan } from "@raidplan/shared";
import { createApp } from "../../src/app.js";
import { loadConfig, type Config } from "../../src/config.js";
import type { Db } from "../../src/db/client.js";
import { users } from "../../src/db/schema.js";
import { createTestDb } from "../../src/db/testDb.js";
import {
  createPlan,
  saveDoc,
  setVisibility,
} from "../../src/plans/planRepo.js";
import {
  inlineUploadedBackground,
  planDescription,
  sharePageHtml,
} from "../../src/og/shareRoutes.js";
import { renderPlanSvg } from "../../src/og/renderPlanSvg.js";
import { renderOgImage } from "../../src/og/renderOgImage.js";
import { Resvg } from "@resvg/resvg-js";

const config: Config = loadConfig({
  NODE_ENV: "test",
  BASE_URL: "https://raidplans.mamzer.dev",
});
const BACKGROUND = { assetId: "arena", width: 1600, height: 900 };

/**
 * A real, **opaque** PNG to stand in for an uploaded map. Generated rather than
 * hard-coded: a transparent one composites to nothing over the dark base and
 * would make "the map rendered" indistinguishable from "no map".
 */
const PNG_2x1 = new Resvg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4">' +
    '<rect width="8" height="4" fill="#c0392b"/></svg>',
)
  .render()
  .asPng();

let db: Db;
let close: () => void;

beforeEach(() => {
  ({ db, close } = createTestDb());
  db.insert(users).values({ id: "u1", discordId: "d1", name: "W" }).run();
  db.insert(users).values({ id: "u2", discordId: "d2", name: "Other" }).run();
});
afterEach(() => close());

const appAs = (userId: string | null) =>
  createApp({ db, config, getUserId: () => userId });

function makePlan(visibility: "private" | "unlisted" | "public") {
  const plan = createPlan(db, {
    ownerId: "u1",
    title: "Mythic Council",
    background: BACKGROUND,
  });
  setVisibility(db, plan.id, visibility);
  return plan;
}

function planDoc(over: Partial<Plan> = {}): Plan {
  return {
    id: "p",
    title: "Test",
    raid: "",
    background: BACKGROUND,
    objects: [],
    steps: [],
    schemaVersion: SCHEMA_VERSION,
    ...over,
  };
}

const token = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "token" as const,
  iconId: "marker-1",
  base: {
    x: 100,
    y: 100,
    w: 64,
    h: 64,
    rotation: 0,
    opacity: 1,
    z: 0,
    visible: true,
    ...over,
  },
});

describe("GET /p/:slug — the share page", () => {
  it("serves Open Graph meta for an unlisted plan, with no login", async () => {
    const plan = makePlan("unlisted");
    const res = await appAs(null).request(`/p/${plan.slug}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    // This is what Discord reads — it doesn't run our JavaScript.
    expect(html).toContain(
      '<meta property="og:title" content="Mythic Council"',
    );
    expect(html).toContain(
      `<meta property="og:image" content="https://raidplans.mamzer.dev/p/${plan.slug}/og.png"`,
    );
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("does not unfurl a private plan to a stranger", async () => {
    const plan = makePlan("private");
    const res = await appAs(null).request(`/p/${plan.slug}`);
    expect(res.status).toBe(404);
    // The title must not leak in the 404 body either.
    expect(await res.text()).not.toContain("Mythic Council");
  });

  it("serves a private plan to its owner", async () => {
    const plan = makePlan("private");
    const res = await appAs("u1").request(`/p/${plan.slug}`);
    expect(res.status).toBe(200);
  });

  it("404s an unknown or malformed slug", async () => {
    expect((await appAs(null).request("/p/aaaaaaaaaa")).status).toBe(404);
    expect((await appAs(null).request("/p/NOT-A-SLUG")).status).toBe(404);
  });

  it("is never cached by a shared proxy", async () => {
    // One guild's private plan must not be served to the next visitor.
    const plan = makePlan("unlisted");
    const res = await appAs(null).request(`/p/${plan.slug}`);
    expect(res.headers.get("cache-control")).toContain("private");
  });

  it("hands humans on to the app's viewer route", async () => {
    const plan = makePlan("public");
    const html = await (await appAs(null).request(`/p/${plan.slug}`)).text();
    // /p/* belongs to the API; the SPA's viewer is /view/:slug.
    expect(html).toContain(`/view/${plan.slug}`);
  });
});

describe("GET /p/:slug/og.png — the preview image", () => {
  it("renders a real PNG", async () => {
    const plan = makePlan("public");
    const res = await appAs(null).request(`/p/${plan.slug}/og.png`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(1, 4).toString()).toBe("PNG");
    expect(body.length).toBeGreaterThan(1000);
  });

  it("refuses to render a private plan for a stranger", async () => {
    const plan = makePlan("private");
    // Otherwise the picture leaks what the page refuses to show.
    expect((await appAs(null).request(`/p/${plan.slug}/og.png`)).status).toBe(
      404,
    );
  });

  it("renders the plan's contents, not an empty board", async () => {
    const plan = makePlan("public");
    saveDoc(db, {
      planId: plan.id,
      doc: planDoc({ id: plan.id, objects: [token("a"), token("b")] }),
    });

    const empty = makePlan("public");
    const withTokens = await appAs(null).request(`/p/${plan.slug}/og.png`);
    const blank = await appAs(null).request(`/p/${empty.slug}/og.png`);

    const a = Buffer.from(await withTokens.arrayBuffer());
    const b = Buffer.from(await blank.arrayBuffer());
    expect(a.length).not.toBe(b.length);
  });
});

describe("uploaded backgrounds in the preview", () => {
  /**
   * Regression: an upload's assetId is a URL path, and resvg reads no network —
   * so the preview rendered byte-identically to having no map at all. Tokens
   * floating on an empty floor, silently.
   */
  const uploadedPlan = (assetId: string) =>
    planDoc({ background: { assetId, width: 8, height: 4 } });

  // Compare *pixels*, not byte length: two different solid colours compress to
  // PNGs of identical length, so a length check would pass either way.
  const blank = () => renderOgImage(uploadedPlan("no-such-map"), -1);

  it("renders nothing for an upload without the file inlined", () => {
    // The bug, pinned: resvg cannot fetch a URL, so the map silently vanishes.
    const withUpload = renderOgImage(uploadedPlan("/uploads/x.png"), -1);
    expect(withUpload.equals(blank())).toBe(true);
  });

  it("renders the map once the file is inlined as a data URI", () => {
    const inlined = renderOgImage(uploadedPlan("/uploads/x.png"), -1, {
      backgroundSrc: `data:image/png;base64,${PNG_2x1.toString("base64")}`,
    });
    expect(inlined.equals(blank())).toBe(false);
  });

  it("inlineUploadedBackground reads the stored file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raidplans-og-"));
    try {
      await writeFile(join(dir, "map.png"), PNG_2x1);
      const src = await inlineUploadedBackground("/uploads/map.png", dir);
      expect(src?.startsWith("data:image/png;base64,")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores bundled maps — they already resolve to inline artwork", async () => {
    expect(await inlineUploadedBackground("arena", "/tmp")).toBeUndefined();
  });

  it("returns undefined rather than throwing when the file is gone", async () => {
    // A deleted upload must not 500 the preview.
    expect(
      await inlineUploadedBackground("/uploads/missing.png", "/tmp"),
    ).toBeUndefined();
  });

  it("cannot be walked out of the uploads directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raidplans-og-"));
    try {
      // Even though the id comes from our own route, a stored string must not
      // be able to assemble a path that escapes.
      expect(
        await inlineUploadedBackground("/uploads/../../etc/passwd.png", dir),
      ).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("renderPlanSvg", () => {
  it("draws the background and each object", () => {
    const svg = renderPlanSvg(planDoc({ objects: [token("a")] }));
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 1600 900"');
    expect(svg).toContain("data:image/svg+xml"); // the icon + map
  });

  it("renders the step's resolved state, not the base layout", () => {
    // The same maths the viewer uses (`resolveObjectState`), so the preview
    // matches what someone sees when they open the link.
    const plan = planDoc({
      objects: [token("a", { x: 0 })],
      steps: [{ id: "s1", overrides: { a: { x: 900 } }, animations: [] }],
    });
    expect(renderPlanSvg(plan, 0)).toContain("translate(900");
    expect(renderPlanSvg(plan, -1)).toContain("translate(0");
  });

  it("skips hidden objects", () => {
    const svg = renderPlanSvg(
      planDoc({ objects: [token("a", { visible: false })] }),
    );
    expect(svg).not.toContain("translate(100 100)");
  });

  it("draws objects in z-order", () => {
    const svg = renderPlanSvg(
      planDoc({
        objects: [
          token("top", { z: 5, x: 500 }),
          token("bottom", { z: 1, x: 10 }),
        ],
      }),
    );
    // The z=1 object must be emitted first, so the z=5 one paints over it.
    expect(svg.indexOf("translate(10 ")).toBeLessThan(
      svg.indexOf("translate(500 "),
    );
  });

  it("escapes labels so a plan can't inject markup", () => {
    const svg = renderPlanSvg(
      planDoc({
        objects: [token("a", { label: "</text><script>x</script>" })],
      }),
    );
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;/text&gt;");
  });

  it("inlines the icon's markup so its glyph actually renders", () => {
    // Regression: embedding the icon as <image href="data:image/svg+xml,…">
    // renders the disc but *silently drops the text* — resvg doesn't draw text
    // inside an embedded SVG image. Every numbered raid marker came out blank,
    // which loses the one thing a marker conveys.
    const svg = renderPlanSvg(planDoc({ objects: [token("a")] }));
    expect(svg).toContain("<text"); // the marker's "1"
    expect(svg).not.toMatch(
      /<image[^>]*href="data:image\/svg\+xml[^"]*"[^>]*\/>\s*<\/g>/,
    );
  });

  it("scales an inlined icon from its own 64² space to the object box", () => {
    const svg = renderPlanSvg(
      planDoc({ objects: [token("a", { w: 128, h: 128 })] }),
    );
    expect(svg).toContain("scale(2 2)");
  });

  it("survives an unknown icon or background", () => {
    expect(() =>
      renderPlanSvg(
        planDoc({
          background: { assetId: "nope", width: 100, height: 100 },
          objects: [{ ...token("a"), iconId: "no-such-icon" }],
        }),
      ),
    ).not.toThrow();
  });
});

describe("renderOgImage", () => {
  it("rasterises to a PNG at the OG width", () => {
    const png = renderOgImage(planDoc({ objects: [token("a")] }));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // PNG stores width big-endian at byte 16.
    expect(png.readUInt32BE(16)).toBe(1200);
  });
});

describe("planDescription", () => {
  it("summarises the plan for the unfurl card", () => {
    expect(
      planDescription(
        planDoc({
          objects: [token("a")],
          steps: [{ id: "s", overrides: {}, animations: [] }],
        }),
      ),
    ).toBe("1 step · 1 object");
  });

  it("pluralises, and leads with the raid when set", () => {
    expect(planDescription(planDoc({ raid: "Aberrus" }))).toBe(
      "Aberrus · 0 steps · 0 objects",
    );
  });
});

describe("sharePageHtml", () => {
  it("escapes a title so a plan can't inject markup into the page", () => {
    const html = sharePageHtml(
      planDoc({ title: '"><script>alert(1)</script>' }),
      "abcdefghij",
      "https://raidplans.mamzer.dev",
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});
