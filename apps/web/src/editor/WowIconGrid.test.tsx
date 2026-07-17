import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEditorStore } from "../store/editorStore";
import { WowIconGrid } from "./WowIconGrid";
import { fetchIconCatalog, IconCatalogError } from "../api/iconCatalog";

// Mock the network client but keep the real error class for the 401 branch.
vi.mock("../api/iconCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/iconCatalog")>();
  return { ...actual, fetchIconCatalog: vi.fn() };
});

const mockFetch = vi.mocked(fetchIconCatalog);

const entry = (id: string, displayName: string) => ({
  id,
  displayName,
  category: "spell" as const,
  url: `/icons/${id}_56.webp`,
});

beforeEach(() => {
  useEditorStore.getState().reset();
  mockFetch.mockReset();
});

describe("WowIconGrid", () => {
  it("renders a tile per icon from the first page", async () => {
    mockFetch.mockResolvedValueOnce({
      items: [entry("spell_fire_a", "Fire A")],
      nextCursor: null,
    });
    render(<WowIconGrid />);
    expect(await screen.findByLabelText("Add Fire A")).toBeInTheDocument();
  });

  it("adds the icon to the store by its stable id when clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      items: [entry("spell_fire_a", "Fire A")],
      nextCursor: null,
    });
    render(<WowIconGrid />);

    const tile = await screen.findByLabelText("Add Fire A");
    expect(useEditorStore.getState().objectIds).toHaveLength(0);
    await user.click(tile);

    const state = useEditorStore.getState();
    expect(state.objectIds).toHaveLength(1);
    expect(state.objects[state.objectIds[0]!]?.iconId).toBe("spell_fire_a");
  });

  it("appends the next page when Load more is clicked", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        items: [entry("spell_fire_a", "Fire A")],
        nextCursor: "cur1",
      })
      .mockResolvedValueOnce({
        items: [entry("spell_frost_b", "Frost B")],
        nextCursor: null,
      });
    render(<WowIconGrid />);

    await screen.findByLabelText("Add Fire A");
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByLabelText("Add Frost B")).toBeInTheDocument();
    // The first page's tile is still present — pages accumulate.
    expect(screen.getByLabelText("Add Fire A")).toBeInTheDocument();
    expect(mockFetch.mock.calls[1]![0].cursor).toBe("cur1");
  });

  it("prompts sign-in on a 401", async () => {
    mockFetch.mockRejectedValueOnce(new IconCatalogError(401));
    render(<WowIconGrid />);
    expect(await screen.findByTestId("wow-error")).toHaveTextContent(
      /sign in/i,
    );
  });

  it("shows a generic error for other failures", async () => {
    mockFetch.mockRejectedValueOnce(new IconCatalogError(500));
    render(<WowIconGrid />);
    expect(await screen.findByTestId("wow-error")).toHaveTextContent(
      /couldn't load/i,
    );
  });

  it("shows an empty state when the catalog returns nothing", async () => {
    mockFetch.mockResolvedValueOnce({ items: [], nextCursor: null });
    render(<WowIconGrid />);
    expect(await screen.findByTestId("wow-empty")).toBeInTheDocument();
  });
});
