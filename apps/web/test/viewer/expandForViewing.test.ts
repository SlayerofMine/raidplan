import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackDef, Plan } from "@raidplan/shared";
import { expandForViewing } from "../../src/viewer/expandForViewing";

vi.mock("../../src/api/client", () => ({
  api: { attack: { byIds: { query: vi.fn() } } },
}));

const { api } = await import("../../src/api/client");
const byIds = vi.mocked(api.attack.byIds.query);

const planWith = (attacks: Plan["steps"][number]["attacks"]): Plan => ({
  id: "p",
  title: "t",
  raid: "",
  background: { assetId: "arena", width: 1600, height: 900 },
  objects: [],
  steps: [{ id: "s0", overrides: {}, animations: [], attacks }],
  schemaVersion: 1,
});

const def: AttackDef = {
  id: "atk1",
  encounterId: "enc1",
  name: "Cone",
  version: 1,
  box: { w: 100, h: 100 },
  anchor: { x: 0, y: 0 },
  objects: [
    {
      id: "cone",
      type: "shape",
      shape: "cone",
      base: {
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        rotation: 0,
        opacity: 1,
        z: 0,
        visible: true,
      },
    },
  ],
  animations: [],
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
        x: 400,
        y: 300,
        rotation: 0,
        scale: 1,
        startMs: 0,
      },
    ]);

    const result = await expandForViewing(plan);

    expect(byIds).toHaveBeenCalledWith({ ids: ["atk1"] });
    expect(result.objects.map((o) => o.id)).toContain("i1::cone");
    // Placed at the instance position (anchor at origin).
    expect(result.objects.find((o) => o.id === "i1::cone")!.base).toMatchObject(
      {
        x: 400,
        y: 300,
      },
    );
  });
});
