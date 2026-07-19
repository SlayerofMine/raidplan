import { describe, expect, it } from "vitest";
import {
  mechanicOps,
  tetherGeometry,
  tetherOps,
  type MechOp,
} from "./mechanics.js";
import { SHAPE_KINDS } from "./effects.js";

const W = 120;
const H = 100;

const count = (ops: MechOp[], t: MechOp["t"]) =>
  ops.filter((o) => o.t === t).length;
const polylines = (ops: MechOp[]) =>
  ops.filter(
    (o): o is Extract<MechOp, { t: "polyline" }> => o.t === "polyline",
  );

describe("mechanicOps — every kind produces drawable ops", () => {
  it("returns at least one op for each shape kind", () => {
    for (const kind of SHAPE_KINDS) {
      expect(mechanicOps(kind, W, H).length).toBeGreaterThan(0);
    }
  });

  it("keeps all geometry within a sane margin of the box", () => {
    // Marks (chevrons/stars) may sit slightly proud; nothing should be wild.
    for (const kind of SHAPE_KINDS) {
      for (const op of mechanicOps(kind, W, H)) {
        if (op.t === "polyline") {
          for (let i = 0; i < op.points.length; i += 2) {
            expect(op.points[i]!).toBeGreaterThan(-W);
            expect(op.points[i]!).toBeLessThan(W * 2);
          }
        }
      }
    }
  });
});

describe("mechanicOps — the visual language distinguishes mechanics", () => {
  it("soak is a concentric target with four inward chevrons", () => {
    const ops = mechanicOps("soak", W, H);
    expect(count(ops, "ellipse")).toBe(2); // outer ring + inner disc
    const chevrons = polylines(ops);
    expect(chevrons).toHaveLength(4); // N/E/S/W
    // Each chevron's tip (middle vertex) points back toward the centre: the tip
    // is nearer the centre than the arms behind it.
    const cx = W / 2;
    const cy = H / 2;
    for (const ch of chevrons) {
      const [ax, ay, tx, ty] = ch.points;
      const tipDist = Math.hypot(tx! - cx, ty! - cy);
      const armDist = Math.hypot(ax! - cx, ay! - cy);
      expect(tipDist).toBeLessThan(armDist);
    }
  });

  it("voidzone reads as hazard (radial fill) — unlike the plain circle", () => {
    const circle = mechanicOps("circle", W, H);
    const voidzone = mechanicOps("voidzone", W, H);
    expect(circle.every((o) => o.fill !== "hazard")).toBe(true);
    expect(voidzone.some((o) => o.fill === "hazard")).toBe(true);
    // ...and its silhouette is a bumpy path, not a clean ellipse.
    expect(voidzone.some((o) => o.t === "path")).toBe(true);
  });

  it("frontals carry directional chevrons", () => {
    expect(polylines(mechanicOps("cone", W, H)).length).toBeGreaterThan(0);
    expect(polylines(mechanicOps("line", W, H)).length).toBe(3);
  });

  it("pickup is a closed star", () => {
    const star = polylines(mechanicOps("pickup", W, H)).find((o) => o.closed);
    expect(star).toBeDefined();
    expect(star!.points.length).toBe(16); // 4-point star = 8 vertices
  });

  it("scales with the box", () => {
    const small = mechanicOps("rect", 10, 10)[0]!;
    const big = mechanicOps("rect", 200, 50)[0]!;
    expect(small).toMatchObject({ t: "rect", w: 10, h: 10 });
    expect(big).toMatchObject({ t: "rect", w: 200, h: 50 });
  });
});

describe("mechanicOps — style customization", () => {
  it("overrides the fill of the primary silhouette", () => {
    expect(mechanicOps("circle", W, H)[0]!.fill).toBe("soft"); // default
    expect(mechanicOps("circle", W, H, { fill: "solid" })[0]!.fill).toBe(
      "solid",
    );
    expect(mechanicOps("circle", W, H, { fill: "none" })[0]!.fill).toBe("none");
  });

  it("drops the outline stroke when outline is false", () => {
    const ops = mechanicOps("rect", W, H, { outline: false });
    expect(ops[0]!.stroke).toBe("none");
  });

  it("makes a voidzone round instead of scalloped", () => {
    // Default silhouette is a bumpy path...
    expect(mechanicOps("voidzone", W, H)[0]!.t).toBe("path");
    // ...round makes it a clean ellipse.
    expect(mechanicOps("voidzone", W, H, { edge: "round" })[0]!.t).toBe(
      "ellipse",
    );
  });

  it("striped fill lays hatch lines behind a hollow outline", () => {
    const ops = mechanicOps("circle", W, H, { fill: "striped" });
    expect(ops[0]!.fill).toBe("none"); // the outline is now hollow
    expect(ops[0]!.stroke).toBe("solid");
    // Several clipped stripe segments, all inside the box.
    const stripes = polylines(ops).filter((o) => !o.closed);
    expect(stripes.length).toBeGreaterThan(2);
    for (const s of stripes) {
      for (let i = 0; i < s.points.length; i += 2) {
        expect(s.points[i]!).toBeGreaterThanOrEqual(-0.01);
        expect(s.points[i]!).toBeLessThanOrEqual(W + 0.01);
      }
    }
  });

  it("striped voidzone becomes a clean striped circle", () => {
    const ops = mechanicOps("voidzone", W, H, { fill: "striped" });
    expect(ops[0]!.t).toBe("ellipse"); // striped forces the round outline
    expect(polylines(ops).some((o) => !o.closed)).toBe(true); // the stripes
  });

  it("leaves the shape untouched when no style is given", () => {
    expect(mechanicOps("voidzone", W, H)).toEqual(
      mechanicOps("voidzone", W, H, {}),
    );
  });
});

describe("tetherGeometry — the primitive both renderers share", () => {
  it("returns a polyline that starts and ends on the endpoints", () => {
    const from = { x: 40, y: 60 };
    const to = { x: 260, y: 60 };
    const g = tetherGeometry(from, to);
    expect(g.points.length).toBeGreaterThan(4); // squiggly = many samples
    expect(g.points.slice(0, 2)).toEqual([from.x, from.y]);
    expect(g.points.slice(-2)).toEqual([to.x, to.y]);
  });

  it("collapses to a single segment when straight", () => {
    const g = tetherGeometry(
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      {
        line: "straight",
      },
    );
    expect(g.points).toEqual([0, 0, 100, 50]);
  });

  it("caps both ends with an anchor bead", () => {
    const g = tetherGeometry({ x: 10, y: 20 }, { x: 90, y: 80 });
    expect(g.anchors).toHaveLength(2);
    expect(g.anchors[0]).toMatchObject({ x: 10, y: 20 });
    expect(g.anchors[1]).toMatchObject({ x: 90, y: 80 });
    expect(g.anchors[0]!.r).toBeGreaterThan(0);
  });
});

describe("tetherOps", () => {
  it("spans the two endpoints and caps each with an anchor", () => {
    const from = { x: 100, y: 100 };
    const to = { x: 300, y: 180 };
    const ops = tetherOps(from, to);

    const path = ops.find((o) => o.t === "path");
    expect(path).toBeDefined();

    const anchors = ops.filter(
      (o): o is Extract<MechOp, { t: "ellipse" }> => o.t === "ellipse",
    );
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toMatchObject({ cx: from.x, cy: from.y });
    expect(anchors[1]).toMatchObject({ cx: to.x, cy: to.y });
  });

  it("starts and ends the line on the endpoints", () => {
    const from = { x: 40, y: 60 };
    const to = { x: 260, y: 60 };
    const path = tetherOps(from, to).find(
      (o): o is Extract<MechOp, { t: "path" }> => o.t === "path",
    )!;
    // First command is M<from>; a straight horizontal line has no lateral wobble
    // at the endpoints (sin(0) = sin(2πk) = 0).
    expect(path.d.startsWith(`M${from.x} ${from.y}`)).toBe(true);
    expect(path.d.trimEnd().endsWith(`L${to.x} ${to.y}`)).toBe(true);
  });

  it("does not divide by zero for coincident endpoints", () => {
    expect(() => tetherOps({ x: 5, y: 5 }, { x: 5, y: 5 })).not.toThrow();
  });

  it("draws a straight two-point line when asked", () => {
    const from = { x: 40, y: 60 };
    const to = { x: 260, y: 140 };
    const path = tetherOps(from, to, { line: "straight" }).find(
      (o): o is Extract<MechOp, { t: "path" }> => o.t === "path",
    )!;
    // Exactly one segment: M<from>L<to>, no intermediate wobble points.
    expect(path.d).toBe(`M${from.x} ${from.y}L${to.x} ${to.y}`);
  });
});
