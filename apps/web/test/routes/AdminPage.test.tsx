import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_BACKGROUND } from "@raidplan/shared";
import { AdminPage } from "../../src/routes/AdminPage";

/** The tRPC client is a Proxy — mock the module, like the HomePage test does. */
vi.mock("../../src/api/client", () => {
  const code = (e: unknown) =>
    (e as { data?: { code?: string } } | undefined)?.data?.code;
  return {
    api: {
      me: { get: { query: vi.fn() } },
      encounter: {
        list: { query: vi.fn() },
        create: { mutate: vi.fn() },
        update: { mutate: vi.fn() },
        remove: { mutate: vi.fn() },
      },
    },
    errorCode: code,
    isUnauthorized: (e: unknown) => code(e) === "UNAUTHORIZED",
    isConflict: (e: unknown) => code(e) === "CONFLICT",
  };
});

vi.mock("../../src/editor/uploadBackground", () => ({
  uploadBackground: vi.fn(),
  UploadError: class UploadError extends Error {},
}));

const { api } = await import("../../src/api/client");
const { uploadBackground } = await import("../../src/editor/uploadBackground");
const meGet = vi.mocked(api.me.get.query);
const encounterList = vi.mocked(api.encounter.list.query);
const encounterCreate = vi.mocked(api.encounter.create.mutate);
const encounterRemove = vi.mocked(api.encounter.remove.mutate);
const upload = vi.mocked(uploadBackground);

const renderPage = () => render(<AdminPage />, { wrapper: MemoryRouter });

const summary = (over: Record<string, unknown> = {}) =>
  ({
    id: "e1",
    slug: "sandbox-arena",
    raid: "Sandbox",
    name: "Arena",
    background: DEFAULT_BACKGROUND,
    ...over,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  encounterList.mockResolvedValue([]);
});

describe("AdminPage — access", () => {
  it("turns a signed-in non-admin away", async () => {
    meGet.mockResolvedValue({ userId: "u1", roles: {}, isAdmin: false });
    renderPage();
    expect(await screen.findByTestId("admin-forbidden")).toBeInTheDocument();
    expect(api.encounter.list.query).not.toHaveBeenCalled();
  });
});

describe("AdminPage — admin", () => {
  beforeEach(() => {
    meGet.mockResolvedValue({ userId: "u1", roles: {}, isAdmin: true });
  });

  it("lists existing encounters", async () => {
    encounterList.mockResolvedValue([summary({ name: "Fyrakk" })]);
    renderPage();
    expect(await screen.findByDisplayValue("Fyrakk")).toBeInTheDocument();
  });

  it("creates an encounter from a name, raid and uploaded battlemap", async () => {
    const user = userEvent.setup();
    const background = { assetId: "/uploads/map.png", width: 800, height: 600 };
    upload.mockResolvedValue(background);
    encounterCreate.mockResolvedValue({ id: "new" } as never);
    renderPage();

    await user.type(await screen.findByTestId("new-encounter-name"), "Fyrakk");
    await user.type(screen.getByTestId("new-encounter-raid"), "Amirdrassil");
    await user.upload(
      screen.getByTestId("new-encounter-map"),
      new File(["x"], "map.png", { type: "image/png" }),
    );

    // Create unlocks once the upload resolves a background.
    await waitFor(() =>
      expect(screen.getByTestId("create-encounter")).toBeEnabled(),
    );
    await user.click(screen.getByTestId("create-encounter"));

    await waitFor(() =>
      expect(encounterCreate).toHaveBeenCalledWith({
        name: "Fyrakk",
        raid: "Amirdrassil",
        background,
      }),
    );
  });

  it("deletes an encounter", async () => {
    const user = userEvent.setup();
    encounterList.mockResolvedValue([summary({ name: "Arena" })]);
    encounterRemove.mockResolvedValue({ ok: true } as never);
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Delete Arena" }),
    );
    expect(encounterRemove).toHaveBeenCalledWith({ id: "e1" });
  });
});
