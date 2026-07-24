import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SCHEMA_VERSION, type AttackDef, type Plan } from "@raidplan/shared";
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
  bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
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
  attacks: [],
  steps: [{ id: "s0", overrides: {}, animations: [] }],
  schemaVersion: SCHEMA_VERSION,
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

  it("is there on the base layout too — attacks are placed on the board", () => {
    state().loadPlan(plan("enc1"));
    state().selectStep(BASE_STEP_INDEX);
    state().addAttack("atk1", { x: 0, y: 0 });
    render(<AttacksPanel />);
    expect(screen.getByTestId("attacks-panel")).toBeInTheDocument();
    expect(screen.getByTestId("placed-attack")).toBeInTheDocument();
  });

  it("places from the base layout onto the first step, which is when it fires", () => {
    state().loadPlan(plan("enc1"));
    state().selectStep(BASE_STEP_INDEX);
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    // "Add it to the board, have it go off in step 1" — no step-picking first.
    expect(state().attacks.find((a) => a.id === id)!.stepId).toBe("s0");
  });

  it("makes a step for an attack when the plan has none, so it can fire at all", () => {
    state().loadPlan({ ...plan("enc1"), steps: [] });
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    expect(state().steps).toHaveLength(1);
    expect(state().attacks.find((a) => a.id === id)!.stepId).toBe(
      state().steps[0]!.id,
    );
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

  it("has no number boxes left — every value has its own home", async () => {
    state().loadPlan(plan("enc1"));
    state().selectStep(0);
    state().addAttack("atk1", { x: 0, y: 0 });
    render(<AttacksPanel />);

    // Position/size/rotation are on the canvas; timing is on the timeline.
    await screen.findByTestId("placed-attack");
    expect(screen.queryByLabelText("Frontal Cone start")).toBeNull();
    expect(screen.queryByLabelText("Frontal Cone rotation")).toBeNull();
    expect(screen.queryByLabelText("Frontal Cone x")).toBeNull();
  });

  it("selects a placed attack, which clears any object selection", async () => {
    const user = userEvent.setup();
    state().loadPlan(plan("enc1"));
    state().selectStep(0);
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
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
    state().addAttack("atk1", { x: 0, y: 0 });
    render(<AttacksPanel />);

    await user.click(
      await screen.findByRole("button", { name: "Remove Frontal Cone" }),
    );
    expect(state().attacks).toHaveLength(0);
  });
});
