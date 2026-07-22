import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackDef, Plan } from "@raidplan/shared";
import { expandForViewing } from "../../src/viewer/expandForViewing";

vi.mock("../../src/api/client", () => ({
  api: { attack: { byIds: { query: vi.fn() } } },
}));

const { api } = await import("../../src/api/client");
const byIds = vi.mocked(api.attack.byIds.query);

const planWith = (attacks: Plan["attacks"]): Plan => ({
  id: "p",
  title: "t",
  raid: "",
  background: { assetId: "arena", width: 1600, height: 900 },
  objects: [],
  attacks,
  steps: [{ id: "s0", overrides: {}, animations: [] }],
  schemaVersion: 2,
});

const def: AttackDef = {
  id: "atk1",
  encounterId: "enc1",
  name: "Cone",
  version: 1,
  defaultSize: { w: 100, h: 100 },
  objects: [
    {
      id: "cone",
      type: "shape",
      shape: "cone",
      // Unit space: the attack spans its own extent, -1..1.
      base: {
        x: -1,
        y: -1,
        w: 2,
        h: 2,
        rotation: 0,
        opacity: 1,
        z: 0,
        visible: true,
      },
    },
  ],
  overrides: {},
  animations: [],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
};

beforeEach(() => vi.clearAllMocks());

describe("expandForViewing", () => {
  it("returns a plan with no attacks untouched, without hitting the network", async () => {
    const plan = planWith([]);
    const result = await expandForViewing(plan);
    expect(result).toBe(plan);
    expect(byIds).not.toHaveBeenCalled();
  });

  it("fetches the referenced defs and stamps them in", async () => {
    byIds.mockResolvedValue([def] as never);
    const plan = planWith([
      {
        id: "i1",
        attackId: "atk1",
        stepId: "s0",
        x: 300,
        y: 200,
        w: 200,
        h: 200,
        rotation: 0,
        startMs: 0,
        args: {},
      },
    ]);

    const result = await expandForViewing(plan);

    expect(byIds).toHaveBeenCalledWith({ ids: ["atk1"] });
    expect(result.objects.map((o) => o.id)).toContain("i1::cone");
    // Mapped onto the instance's rectangle, which is the attack's own box.
    expect(result.objects.find((o) => o.id === "i1::cone")!.base).toMatchObject(
      { x: 300, y: 200, w: 200, h: 200 },
    );
  });
});
