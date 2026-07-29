import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CollapsiblePanel,
  PANELS_KEY,
} from "../../src/editor/CollapsiblePanel";

beforeEach(() => {
  localStorage.clear();
});

const panel = (id = "objects") => (
  <CollapsiblePanel id={id} title="Objects" aside={3} testId="a-panel">
    <p data-testid="body">the cast</p>
  </CollapsiblePanel>
);

const toggle = (id = "objects") => screen.getByTestId(`${id}-toggle`);

describe("CollapsiblePanel", () => {
  it("opens by default and hides its body when shut", () => {
    render(panel());
    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle());
    expect(screen.queryByTestId("body")).not.toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle());
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });

  // The title and its summary are the landmark you navigate the shut rail by,
  // so neither may go away with the body.
  it("keeps its heading and summary visible while shut", () => {
    render(panel());
    fireEvent.click(toggle());
    expect(
      screen.getByRole("heading", { name: /Objects/ }),
    ).toBeInTheDocument();
    expect(toggle()).toHaveTextContent("3");
  });

  it("remembers each panel separately across a remount", () => {
    const { unmount } = render(
      <>
        {panel("objects")}
        {panel("animations")}
      </>,
    );
    fireEvent.click(toggle("animations"));
    unmount();

    render(
      <>
        {panel("objects")}
        {panel("animations")}
      </>,
    );
    expect(toggle("objects")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("animations")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens when the remembered state is missing, corrupt or not a boolean", () => {
    for (const raw of ["", "{", "null", "[]", '{"objects":"yes"}']) {
      localStorage.setItem(PANELS_KEY, raw);
      const { unmount } = render(panel());
      expect(toggle()).toHaveAttribute("aria-expanded", "true");
      unmount();
    }
  });

  it("survives storage it cannot write to", () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    try {
      render(panel());
      // The collapse still happens; only remembering it is lost.
      fireEvent.click(toggle());
      expect(screen.queryByTestId("body")).not.toBeInTheDocument();
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});
