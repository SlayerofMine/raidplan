import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ICONS } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { IconPalette } from "./IconPalette";

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
});
