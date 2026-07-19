import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BASE_STEP_INDEX, useEditorStore } from "../../store/editorStore";
import { TimelineDock } from "./TimelineDock";

const state = () => useEditorStore.getState();
const open = () => fireEvent.click(screen.getByTestId("timeline-toggle"));

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
});

describe("TimelineDock", () => {
  it("is collapsed by default so it doesn't steal canvas space", () => {
    render(<TimelineDock />);
    expect(screen.getByTestId("timeline-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByTestId("timeline-no-step")).not.toBeInTheDocument();
  });

  it("prompts to pick a step while on the Base layout", () => {
    state().addStep();
    state().selectStep(BASE_STEP_INDEX);
    render(<TimelineDock />);
    open();
    expect(screen.getByTestId("timeline-no-step")).toBeInTheDocument();
  });

  it("shows only the current step's chart", () => {
    state().addStep(); // step 0
    state().addStep(); // step 1 — now current
    render(<TimelineDock />);
    open();
    expect(screen.getByTestId("timeline-step-1")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-step-0")).not.toBeInTheDocument();
  });

  it("names the current step in the toggle", () => {
    state().addStep();
    state().setStepName(0, "Pull");
    render(<TimelineDock />);
    expect(screen.getByTestId("timeline-toggle")).toHaveTextContent("Pull");
  });
});
