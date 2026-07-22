import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AttackDef } from "@raidplan/shared";
import { TimelineChart } from "../../src/editor/timeline/TimelineChart";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

/**
 * A placed attack gets a timeline bar (plan §18.6), so *when it fires* is
 * dragged like everything else rather than typed into a box.
 */
const state = () => useEditorStore.getState();

const def: AttackDef = {
  id: "atk1",
  encounterId: "enc1",
  name: "Frontal Cone",
  version: 1,
  defaultSize: { w: 100, h: 100 },
  objects: [],
  overrides: {},
  animations: [
    {
      id: "a1",
      objectId: "o1",
      kind: "motion",
      effect: "move",
      trigger: "onEnter",
      delayMs: 0,
      durationMs: 800,
      easing: "none",
    },
  ],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, tint: {} },
};

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  clearHistory();
  state().setAttackDefs({ atk1: def });
});

describe("attack bars", () => {
  it("shows a bar for a placed attack, even with no animations on the step", async () => {
    state().addStep();
    state().addAttack("atk1", { x: 0, y: 0 });
    render(<TimelineChart stepIndex={0} />);

    // An attack alone is enough content — the "no animations" state must go.
    expect(screen.queryByTestId("timeline-empty-0")).not.toBeInTheDocument();
    const id = state().attacks[0]!.id;
    expect(screen.getByTestId(`timeline-attack-${id}`)).toBeInTheDocument();
    // The label describes when it fires and how long it runs.
    expect(screen.getByTestId(`timeline-attack-${id}`)).toHaveAccessibleName(
      /Frontal Cone · starts 0ms · 800ms/,
    );
  });

  it("nudges when it fires with the arrow keys", async () => {
    const user = userEvent.setup();
    state().addStep();
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    render(<TimelineChart stepIndex={0} />);

    const bar = screen.getByTestId(`timeline-attack-${id}`);
    bar.focus();
    await user.keyboard("{ArrowRight}");

    expect(state().attacks[0]!.startMs).toBeGreaterThan(0);
  });

  it("stretches the whole attack from the bar's right edge", async () => {
    const user = userEvent.setup();
    state().addStep();
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    render(<TimelineChart stepIndex={0} />);

    const handle = screen.getByTestId(`timeline-attack-handle-${id}`);
    handle.focus();
    await user.keyboard("{ArrowRight}");

    // It starts with no duration of its own — following the definition — and
    // only pins one once you pull it.
    expect(state().attacks[0]!.durationMs).toBeGreaterThan(800);
  });

  it("says how much slower it now runs", async () => {
    const user = userEvent.setup();
    state().addStep();
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    render(<TimelineChart stepIndex={0} />);

    state().updateAttack(id, { durationMs: 1600 });
    await user.click(screen.getByTestId(`timeline-attack-row-${id}`));

    // 800ms of attack played over 1600ms is half speed.
    expect(screen.getByTestId(`timeline-attack-${id}`)).toHaveAccessibleName(
      /1600ms · 0.50× speed/,
    );
  });

  it("selects the attack when its bar is clicked", async () => {
    const user = userEvent.setup();
    state().addStep();
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    render(<TimelineChart stepIndex={0} />);

    await user.click(screen.getByTestId(`timeline-attack-row-${id}`));
    expect(state().selectedAttackIds).toEqual([id]);
  });
});
