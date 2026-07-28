import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SCHEMA_VERSION, type AttackDef, type Plan } from "@raidplan/shared";
import { AttacksPanel } from "../../src/editor/AttacksPanel";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

const state = () => useEditorStore.getState();

const def = (over: Partial<AttackDef> = {}): AttackDef => ({
  id: "atk1",
  scope: { kind: "encounter", encounterId: "enc1" },
  name: "Frontal Cone",
  version: 1,
  defaultSize: { w: 100, h: 100 },
  objects: [],
  slides: [{ id: "end", states: {}, animations: [] }],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
  ...over,
});

/** A plan seeded from an encounter, with one slide. */
const plan = (encounterId?: string): Plan => ({
  id: "p",
  title: "t",
  raid: "",
  ...(encounterId ? { encounterId } : {}),
  background: { assetId: "arena", width: 1600, height: 900 },
  objects: [],
  attacks: [],
  slides: [{ id: "s0", states: {}, animations: [] }],
  groups: {},
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

  it("is there on the opening slide too — attacks are placed on the board", () => {
    state().loadPlan(plan("enc1"));
    state().selectSlide(0);
    state().addAttack("atk1", { x: 0, y: 0 });
    render(<AttacksPanel />);
    expect(screen.getByTestId("attacks-panel")).toBeInTheDocument();
    expect(screen.getByTestId("placed-attack")).toBeInTheDocument();
  });

  it("places onto the slide being edited, which is when it fires", () => {
    state().loadPlan(plan("enc1"));
    state().selectSlide(0);
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    // "Add it to the board, have it go off on slide 1" — no slide-picking first.
    expect(state().attacks.find((a) => a.id === id)!.slideId).toBe("s0");
  });

  it("always has a slide to fire on — a plan can't have none", () => {
    // `addAttack` used to create a slide when the plan had zero. `PlanSchema`
    // now requires one, so there is no such state to recover from.
    state().loadPlan(plan("enc1"));
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    expect(state().slides).toHaveLength(1);
    expect(state().attacks.find((a) => a.id === id)!.slideId).toBe(
      state().slides[0]!.id,
    );
  });

  it("points at the palette when nothing is placed — it isn't a second library", async () => {
    state().loadPlan(plan("enc1"));
    state().selectSlide(0);
    render(<AttacksPanel />);

    expect(await screen.findByTestId("no-placed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Place Frontal Cone" }),
    ).toBeNull();
  });

  it("has no number boxes left — every value has its own home", async () => {
    state().loadPlan(plan("enc1"));
    state().selectSlide(0);
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
    state().selectSlide(0);
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
    state().selectSlide(0);
    state().addAttack("atk1", { x: 0, y: 0 });
    render(<AttacksPanel />);

    await user.click(
      await screen.findByRole("button", { name: "Remove Frontal Cone" }),
    );
    expect(state().attacks).toHaveLength(0);
  });
});
