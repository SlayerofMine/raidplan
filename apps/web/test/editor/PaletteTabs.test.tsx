import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SCHEMA_VERSION, type AttackDef, type Plan } from "@raidplan/shared";
import { AttacksTab } from "../../src/editor/PaletteTabs";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

const state = () => useEditorStore.getState();

const def = (id: string, over: Partial<AttackDef> = {}): AttackDef => ({
  id,
  scope: { kind: "encounter", encounterId: "enc1" },
  name: id,
  version: 1,
  defaultSize: { w: 100, h: 100 },
  objects: [],
  slides: [{ id: "end", states: {}, animations: [] }],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
  ...over,
});

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: "p1",
  title: "t",
  raid: "",
  background: { assetId: "arena", width: 1600, height: 900 },
  objects: [],
  attacks: [],
  slides: [{ id: "s0", states: {}, animations: [] }],
  groups: {},
  schemaVersion: SCHEMA_VERSION,
  ...over,
});

const show = () =>
  render(
    <MemoryRouter>
      <AttacksTab />
    </MemoryRouter>,
  );

beforeEach(() => {
  state().reset();
  clearHistory();
});

describe("the attacks palette (§19.4)", () => {
  it("sorts the two libraries into their own sections", () => {
    // "Who else sees this" is a fact the author needs continuously and cannot
    // read off a thumbnail: editing a curated attack changes it for everyone
    // working the fight, editing your own changes it for you.
    state().loadPlan(plan({ encounterId: "enc1" }));
    state().setAttackDefs({
      curated: def("curated"),
      mine: def("mine", { scope: { kind: "plan", planId: "p1" } }),
    });
    show();

    const encounter = screen.getByTestId("encounter-attacks");
    const own = screen.getByTestId("plan-attacks");
    expect(within(encounter).getByLabelText("Place curated")).toBeVisible();
    expect(within(encounter).queryByLabelText("Place mine")).toBeNull();
    expect(within(own).getByLabelText("Place mine")).toBeVisible();
  });

  it("gives a plan with no encounter its own section and a way in", () => {
    // This is the case §19 exists for: before it, such a plan had no attacks
    // and no way to get any.
    state().loadPlan(plan());
    show();
    expect(screen.queryByTestId("encounter-attacks")).toBeNull();
    expect(screen.getByTestId("plan-attacks")).toBeVisible();
    expect(screen.getByTestId("new-plan-attack")).toHaveAttribute(
      "href",
      "/plan/p1/attacks/new",
    );
  });

  it("says so on the offline plan, which has no server to author against", () => {
    state().loadPlan(plan({ id: "local" }));
    show();
    expect(screen.queryByTestId("new-plan-attack")).toBeNull();
    expect(screen.getByTestId("attacks-local-plan")).toBeVisible();
  });

  it("still refuses to place an attack whose slots aren't filled", () => {
    // §18.14's rule, unchanged by the sections: a definition with holes needs a
    // selection to fill them.
    state().loadPlan(plan({ encounterId: "enc1" }));
    state().setAttackDefs({
      frontal: def("frontal", {
        objects: [
          {
            id: "caster",
            type: "placeholder",
            base: {
              x: 0,
              y: 0,
              w: 1,
              h: 1,
              rotation: 0,
              opacity: 1,
              z: 0,
              visible: true,
            },
          },
        ],
      }),
    });
    show();
    expect(screen.getByLabelText("Place frontal")).toBeDisabled();
    expect(screen.getByTestId("needs-slots-frontal")).toBeVisible();
  });
});
