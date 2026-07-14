import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ICONS } from "../assets/icons";
import { useEditorStore } from "../store/editorStore";
import { IconPalette } from "./IconPalette";

beforeEach(() => {
  useEditorStore.getState().reset();
});

describe("IconPalette", () => {
  it("renders one button per icon", () => {
    render(<IconPalette />);
    expect(screen.getAllByRole("button")).toHaveLength(ICONS.length);
  });

  it("adds an object to the store when an icon is clicked", async () => {
    const user = userEvent.setup();
    render(<IconPalette />);
    expect(useEditorStore.getState().objectIds).toHaveLength(0);
    await user.click(screen.getByLabelText(`Add ${ICONS[0]!.name}`));
    expect(useEditorStore.getState().objectIds).toHaveLength(1);
  });
});
