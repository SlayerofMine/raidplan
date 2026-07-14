import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  it("renders the title and a link into the editor", () => {
    render(<HomePage />, { wrapper: MemoryRouter });
    expect(
      screen.getByRole("heading", { name: /raidplans/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open editor/i })).toHaveAttribute(
      "href",
      "/plan/local/edit",
    );
  });
});
