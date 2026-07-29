import { describe, expect, it } from "vitest";
import { layoutStepTimeline, type Anim } from "@raidplan/shared";
import { buildTimelineRows } from "../../../src/editor/timeline/timelineRows";

function anim(id: string, objectId: string, over: Partial<Anim> = {}): Anim {
  return {
    id,
    objectId,
    kind: "motion",
    effect: "move",
    trigger: "afterPrevious",
    delayMs: 0,
    durationMs: 500,
    easing: "power2.out",
    ...over,
  };
}

const rowsOf = (
  animations: Anim[],
  groupOf: (id: string) => string | undefined = () => undefined,
  attackOf: (id: string) => string | undefined = () => undefined,
) => buildTimelineRows(layoutStepTimeline(animations).spans, groupOf, attackOf);

const none = () => undefined;

describe("buildTimelineRows — attacks (plan §21)", () => {
  /** Three legs of one attack, on three of its objects. */
  const attack = [
    anim("a1", "puddle", { trigger: "onEnter", delayMs: 200, durationMs: 300 }),
    anim("a2", "bolt", { durationMs: 400 }),
    anim("a3", "spark", { kind: "emphasis", effect: "pulse", durationMs: 100 }),
  ];
  const inAttack = (id: string) =>
    ["puddle", "bolt", "spark"].includes(id) ? "atk_1" : undefined;

  it("is one row, however many objects it took", () => {
    const rows = rowsOf(attack, none, inAttack);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("attack");
    expect(rows[0]!.id).toBe("atk_1");
  });

  it("is one bar, however many animations it took", () => {
    const rows = rowsOf(attack, none, inAttack);
    expect(rows[0]!.bars).toHaveLength(1);
  });

  it("spans everything the attack does, from the first start to the last end", () => {
    const spans = layoutStepTimeline(attack).spans;
    const bar = rowsOf(attack, none, inAttack)[0]!.bars[0]!;
    expect(bar.span.startMs).toBe(Math.min(...spans.map((s) => s.startMs)));
    expect(bar.span.endMs).toBe(Math.max(...spans.map((s) => s.endMs)));
  });

  it("carries every animation, so retiming the bar reaches all of them", () => {
    const bar = rowsOf(attack, none, inAttack)[0]!.bars[0]!;
    expect([...bar.animIds].sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("is drawn from zero, because the block's own head is absolute", () => {
    const bar = rowsOf(attack, none, inAttack)[0]!.bars[0]!;
    expect(bar.span.triggerMs).toBe(0);
    // The lead-in dash is the attack's start — the very thing dragging changes.
    expect(bar.span.delayMs).toBe(200);
  });

  it("leaves a collision out of the extent, the way the slide's own length does", () => {
    const withDeferred = [
      ...attack,
      anim("a4", "bolt", {
        trigger: "onCollision",
        collideWith: ["puddle"],
        durationMs: 9000,
      }),
    ];
    const bar = rowsOf(withDeferred, none, inAttack)[0]!.bars[0]!;
    expect(bar.span.endMs).toBeLessThan(9000);
    // It is still carried, so retiming the attack retimes it too.
    expect(bar.animIds).toContain("a4");
  });

  it("wins over the group its objects are also in — being one attack is the more specific claim", () => {
    const rows = rowsOf(attack, () => "grp_1", inAttack);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("attack");
  });

  it("leaves everything that isn't an attack exactly as it was", () => {
    const plain = [anim("b1", "tank"), anim("b2", "healer")];
    expect(rowsOf(plain).map((r) => r.kind)).toEqual(["object", "object"]);
    expect(rowsOf(plain, () => "grp_1").map((r) => r.kind)).toEqual(["group"]);
  });

  it("keeps an attack and the rest of the slide apart", () => {
    const mixed = [...attack, anim("b1", "tank", { trigger: "onEnter" })];
    const rows = rowsOf(mixed, none, inAttack);
    expect(rows.map((r) => r.kind)).toEqual(["attack", "object"]);
  });
});
