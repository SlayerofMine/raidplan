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

const state = () => useEditorStore.getState();

const def = (over: Partial<AttackDef> = {}): AttackDef => ({
  id: "atk1",
  encounterId: "enc1",
  name: "Frontal Cone",
  version: 1,
  defaultSize: { w: 100, h: 100 },
  objects: [],
  overrides: {},
  animations: [],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, tint: {} },
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
  schemaVersion: 2,
});

beforeEach(() => {
  vi.clearAllMocks();
  state().reset();
  clearHistory();
  // Loaded by AttackDefResolver in the real app; seeded directly here.
  state().setAttackDefs({ atk1: def() });
});

describe("AttacksPanel", () => {
  it("stays out of the way for a plan with no encounter", () => {
    state().loadPlan(plan());
    render(<AttacksPanel />);
    expect(screen.queryByTestId("attacks-panel")).not.toBeInTheDocument();
  });

  it("stays out of the way on the base layout, where attacks can't exist", () => {
    state().loadPlan(plan("enc1"));
    state().selectStep(BASE_STEP_INDEX);
    render(<AttacksPanel />);
    expect(screen.queryByTestId("attacks-panel")).not.toBeInTheDocument();
  });

  it("points at the palette when nothing is placed — it isn't a second library", async () => {
    state().loadPlan(plan("enc1"));
    state().selectStep(0);
    render(<AttacksPanel />);

    expect(await screen.findByTestId("no-placed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Place Frontal Cone" }),
    ).toBeNull();
  });

  it("tunes only what the canvas can't express — when it fires", async () => {
    const user = userEvent.setup();
    state().loadPlan(plan("enc1"));
    state().selectStep(0);
    state().addAttack(0, "atk1", { x: 0, y: 0 });
    render(<AttacksPanel />);

    const start = await screen.findByLabelText("Frontal Cone start");
    await user.clear(start);
    await user.type(start, "250");
    expect(state().steps[0]!.attacks![0]!.startMs).toBe(250);

    // Position/size/rotation are edited on the canvas, not here.
    expect(screen.queryByLabelText("Frontal Cone rotation")).toBeNull();
    expect(screen.queryByLabelText("Frontal Cone x")).toBeNull();
  });

  it("selects a placed attack, which clears any object selection", async () => {
    const user = userEvent.setup();
    state().loadPlan(plan("enc1"));
    state().selectStep(0);
    const id = state().addAttack(0, "atk1", { x: 0, y: 0 })!;
    state().select([]);
    render(<AttacksPanel />);

    await user.click(
      await screen.findByRole("button", { name: "Select Frontal Cone" }),
    );
    expect(state().selectedAttackIds).toEqual([id]);
    expect(state().selectedIds).toEqual([]);
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
