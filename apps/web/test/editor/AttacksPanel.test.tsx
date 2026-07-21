import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AttackDef, Plan } from "@raidplan/shared";
import { AttacksPanel } from "../../src/editor/AttacksPanel";
import {
  BASE_STEP_INDEX,
  clearHistory,
  useEditorStore,
} from "../../src/store/editorStore";

vi.mock("../../src/api/client", () => ({
  api: { attack: { listForEncounter: { query: vi.fn() } } },
}));

const { api } = await import("../../src/api/client");
const listForEncounter = vi.mocked(api.attack.listForEncounter.query);

const state = () => useEditorStore.getState();

const def = (over: Partial<AttackDef> = {}): AttackDef => ({
  id: "atk1",
  encounterId: "enc1",
  name: "Frontal Cone",
  version: 1,
  box: { w: 100, h: 100 },
  anchor: { x: 50, y: 50 },
  objects: [],
  overrides: {},
  animations: [],
  ...over,
});

/** A plan seeded from an encounter, with one step. */
const plan = (encounterId?: string): Plan => ({
  id: "p",
  title: "t",
  raid: "",
  ...(encounterId ? { encounterId } : {}),
  background: { assetId: "arena", width: 1600, height: 900 },
  objects: [],
  steps: [{ id: "s0", overrides: {}, animations: [] }],
  schemaVersion: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  listForEncounter.mockResolvedValue([def()] as never);
  state().reset();
  clearHistory();
});

describe("AttacksPanel", () => {
  it("stays out of the way for a plan with no encounter", () => {
    state().loadPlan(plan());
    render(<AttacksPanel />);
    expect(screen.queryByTestId("attacks-panel")).not.toBeInTheDocument();
    expect(listForEncounter).not.toHaveBeenCalled();
  });

  it("says attacks belong to a step while on the base layout", async () => {
    state().loadPlan(plan("enc1"));
    state().selectStep(BASE_STEP_INDEX);
    render(<AttacksPanel />);
    expect(await screen.findByTestId("attacks-need-step")).toBeInTheDocument();
  });

  it("offers the encounter's attacks and places one on the step", async () => {
    const user = userEvent.setup();
    state().loadPlan(plan("enc1"));
    state().selectStep(0);
    render(<AttacksPanel />);

    await user.click(
      await screen.findByRole("button", { name: "Place Frontal Cone" }),
    );

    const placed = state().steps[0]!.attacks!;
    expect(placed).toHaveLength(1);
    // Dropped at the middle of the board.
    expect(placed[0]).toMatchObject({ attackId: "atk1", x: 800, y: 450 });
  });

  it("retunes a placed attack's transform and timing", async () => {
    const user = userEvent.setup();
    state().loadPlan(plan("enc1"));
    state().selectStep(0);
    state().addAttack(0, "atk1", { x: 0, y: 0 });
    render(<AttacksPanel />);

    const rotation = await screen.findByLabelText("Frontal Cone rotation");
    await user.clear(rotation);
    await user.type(rotation, "90");

    expect(state().steps[0]!.attacks![0]!.rotation).toBe(90);
  });

  it("removes a placed attack", async () => {
    const user = userEvent.setup();
    state().loadPlan(plan("enc1"));
    state().selectStep(0);
    state().addAttack(0, "atk1", { x: 0, y: 0 });
    render(<AttacksPanel />);

    await user.click(
      await screen.findByRole("button", { name: "Remove Frontal Cone" }),
    );
    expect(state().steps[0]!.attacks).toHaveLength(0);
  });
});
