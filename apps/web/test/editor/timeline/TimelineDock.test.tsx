import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEditorStore } from "../../../src/store/editorStore";
import { TimelineDock } from "../../../src/editor/timeline/TimelineDock";

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
    expect(screen.queryByTestId("timeline-slide-0")).not.toBeInTheDocument();
  });

  it("charts the opening slide, which a plan always has", () => {
    // There is no "no slide selected" state to prompt about any more: the Base
    // layout was the only thing that wasn't a slide, and it's gone.
    render(<TimelineDock />);
    open();
    expect(screen.getByTestId("timeline-slide-0")).toBeInTheDocument();
  });

  it("shows only the current slide's chart", () => {
    state().addSlide(); // slide 1 — now current
    render(<TimelineDock />);
    open();
    expect(screen.getByTestId("timeline-slide-1")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-slide-0")).not.toBeInTheDocument();
  });

  it("names the current slide in the toggle", () => {
    state().setSlideName(0, "Pull");
    render(<TimelineDock />);
    expect(screen.getByTestId("timeline-toggle")).toHaveTextContent("Pull");
  });
});
