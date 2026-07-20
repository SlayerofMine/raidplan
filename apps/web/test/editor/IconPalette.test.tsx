import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ICONS } from "@raidplan/shared";
import { useEditorStore } from "../../src/store/editorStore";
import { IconPalette } from "../../src/editor/IconPalette";

// The WoW grid is server-backed; stub it so the palette's own tests stay
// hermetic (its behaviour is covered in WowIconGrid.test.tsx).
vi.mock("../../src/editor/WowIconGrid", () => ({
  WowIconGrid: () => <div data-testid="wow-grid-stub" />,
}));

/** Only the icon tiles — excludes the category chips. */
const iconButtons = () => screen.getAllByRole("button", { name: /^Add / });

beforeEach(() => {
  useEditorStore.getState().reset();
});

describe("IconPalette", () => {
  it("renders one tile per icon in the manifest", () => {
    render(<IconPalette />);
    expect(iconButtons()).toHaveLength(ICONS.length);
  });

  it("exposes the palette as a labelled landmark (a11y, plan §5.3)", () => {
    render(<IconPalette />);
    expect(
      screen.getByRole("complementary", { name: "Icons" }),
    ).toBeInTheDocument();
  });

  it("adds an object to the store when an icon is clicked", async () => {
    const user = userEvent.setup();
    render(<IconPalette />);
    expect(useEditorStore.getState().objectIds).toHaveLength(0);

    await user.click(screen.getByLabelText(`Add ${ICONS[0]!.name}`));
    expect(useEditorStore.getState().objectIds).toHaveLength(1);
  });

  it("filters the tiles by search query", async () => {
    const user = userEvent.setup();
    render(<IconPalette />);

    await user.type(screen.getByTestId("icon-search"), "paladin");
    expect(iconButtons()).toHaveLength(1);
    expect(screen.getByLabelText("Add Paladin")).toBeInTheDocument();
  });

  it("filters the tiles by category", async () => {
    const user = userEvent.setup();
    render(<IconPalette />);

    await user.click(screen.getByRole("button", { name: "role" }));
    const roles = ICONS.filter((i) => i.category === "role");
    expect(iconButtons()).toHaveLength(roles.length);
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(<IconPalette />);

    await user.type(screen.getByTestId("icon-search"), "zzzz-nope");
    expect(screen.getByTestId("palette-empty")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^Add / })).toHaveLength(0);
  });

  it("defaults to the bundled Tokens tab, not the WoW grid", () => {
    render(<IconPalette />);
    expect(iconButtons().length).toBeGreaterThan(0);
    expect(screen.queryByTestId("wow-grid-stub")).not.toBeInTheDocument();
  });

  it("switches to the WoW grid and back", async () => {
    const user = userEvent.setup();
    render(<IconPalette />);

    await user.click(screen.getByRole("tab", { name: "WoW" }));
    expect(screen.getByTestId("wow-grid-stub")).toBeInTheDocument();
    // The bundled search box is gone while the WoW tab is active.
    expect(screen.queryByTestId("icon-search")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Tokens" }));
    expect(screen.getByTestId("icon-search")).toBeInTheDocument();
  });
});
