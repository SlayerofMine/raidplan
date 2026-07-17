import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { HomePage } from "./HomePage";
import { LOCAL_PLAN_ID } from "../editor/planScope";

/**
 * The tRPC client is a Proxy — its methods don't physically exist until called,
 * so they can't be spied on. Mock the module instead.
 */
vi.mock("../api/client", () => {
  const code = (e: unknown) =>
    (e as { data?: { code?: string } } | undefined)?.data?.code;
  return {
    api: {
      me: { get: { query: vi.fn() } },
      plan: {
        list: { query: vi.fn() },
        create: { mutate: vi.fn() },
        duplicate: { mutate: vi.fn() },
      },
    },
    errorCode: code,
    isUnauthorized: (e: unknown) => code(e) === "UNAUTHORIZED",
    isConflict: (e: unknown) => code(e) === "CONFLICT",
  };
});

const { api } = await import("../api/client");
const meGet = vi.mocked(api.me.get.query);
const planList = vi.mocked(api.plan.list.query);
const planDuplicate = vi.mocked(api.plan.duplicate.mutate);

/** A tRPC-shaped rejection, as the client surfaces it. */
function trpcError(code: string) {
  return Object.assign(new Error(code), { data: { code } });
}

const renderPage = () => render(<HomePage />, { wrapper: MemoryRouter });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HomePage — signed out", () => {
  beforeEach(() => {
    // `me.get` is protected: UNAUTHORIZED is the normal signed-out answer.
    meGet.mockRejectedValue(trpcError("UNAUTHORIZED"));
  });

  it("offers a Discord sign-in", async () => {
    renderPage();
    const link = await screen.findByTestId("sign-in");
    expect(link).toHaveAttribute("href", expect.stringContaining("/api/login"));
  });

  it("still offers the offline editor without an account", async () => {
    renderPage();
    // The whole point of the local plan: usable with no sign-in at all.
    const link = await screen.findByRole("link", { name: /offline editor/i });
    expect(link).toHaveAttribute("href", `/plan/${LOCAL_PLAN_ID}/edit`);
  });

  it("does not try to list plans when signed out", async () => {
    renderPage();
    await screen.findByTestId("sign-in");
    expect(planList).not.toHaveBeenCalled();
  });
});

describe("HomePage — API unreachable", () => {
  /** What an empty 500 from the dev proxy actually looks like to the client. */
  const parseFailure = () => new Error("Unexpected end of JSON input"); // no `data.code`

  it("says the server is unreachable instead of pretending you're signed out", async () => {
    // Offering a sign-in button that cannot possibly work is worse than saying
    // what's wrong — this is what an unstarted API looks like in dev.
    meGet.mockRejectedValue(parseFailure());
    renderPage();

    expect(await screen.findByTestId("api-unreachable")).toBeInTheDocument();
    expect(screen.queryByTestId("sign-in")).not.toBeInTheDocument();
  });

  it("still offers the offline plan, which doesn't need the server", async () => {
    meGet.mockRejectedValue(parseFailure());
    renderPage();
    await screen.findByTestId("api-unreachable");
    expect(
      screen.getByRole("link", { name: /offline editor/i }),
    ).toBeInTheDocument();
  });

  it("does not try to list plans", async () => {
    meGet.mockRejectedValue(parseFailure());
    renderPage();
    await screen.findByTestId("api-unreachable");
    expect(planList).not.toHaveBeenCalled();
  });

  it("offers a retry", async () => {
    meGet.mockRejectedValue(parseFailure());
    renderPage();
    expect(await screen.findByTestId("session-retry")).toBeInTheDocument();
  });
});

describe("HomePage — signed in", () => {
  beforeEach(() => {
    meGet.mockResolvedValue({ userId: "u1", roles: {} });
  });

  const summary = (over: Record<string, unknown> = {}) =>
    ({
      id: "p1",
      title: "Mythic Council",
      slug: "abcdefghij",
      raid: "",
      ownerId: "u1",
      guildId: null,
      visibility: "private",
      thumbnailUrl: null,
      updatedAt: 0,
      ...over,
    }) as never;

  it("lists the user's plans, linking to the editor", async () => {
    planList.mockResolvedValue([summary()]);
    renderPage();

    expect(await screen.findByText("Mythic Council")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Mythic Council/ }),
    ).toHaveAttribute("href", "/plan/p1/edit");
    expect(screen.getByTestId("sign-out")).toBeInTheDocument();
  });

  it("shows an empty state rather than nothing", async () => {
    planList.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByTestId("plans-empty")).toBeInTheDocument();
  });

  it("surfaces a failure to load plans instead of spinning forever", async () => {
    planList.mockRejectedValue(trpcError("INTERNAL_SERVER_ERROR"));
    renderPage();
    expect(await screen.findByTestId("plans-error")).toBeInTheDocument();
  });

  it("offers to create a plan", async () => {
    planList.mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("new-plan")).toBeInTheDocument(),
    );
  });

  it("shows an OG-rendered thumbnail for each plan", async () => {
    planList.mockResolvedValue([summary({ slug: "abcdefghij" })]);
    renderPage();
    const thumb = await screen.findByTestId("plan-thumb");
    expect(thumb).toHaveAttribute("src", "/p/abcdefghij/og.png");
  });

  it("filters plans by the search box", async () => {
    const user = userEvent.setup();
    planList.mockResolvedValue([
      summary({ id: "p1", title: "Mythic Council" }),
      summary({ id: "p2", title: "Heroic Ansurek", slug: "slug2" }),
    ]);
    renderPage();
    await screen.findByText("Mythic Council");

    await user.type(screen.getByTestId("plan-search"), "ansurek");
    expect(screen.queryByText("Mythic Council")).not.toBeInTheDocument();
    expect(screen.getByText("Heroic Ansurek")).toBeInTheDocument();
  });

  it("offers a raid filter only when plans have raids", async () => {
    planList.mockResolvedValue([
      summary({ id: "p1", title: "A", raid: "Nerub-ar Palace" }),
      summary({ id: "p2", title: "B", slug: "slug2", raid: "" }),
    ]);
    renderPage();
    await screen.findByText("A");
    expect(screen.getByTestId("raid-filter")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Nerub-ar Palace" }),
    ).toBeInTheDocument();
  });

  it("duplicates a plan and refreshes the list", async () => {
    const user = userEvent.setup();
    planList.mockResolvedValue([summary({ title: "Mythic Council" })]);
    planDuplicate.mockResolvedValue({ id: "p2" } as never);
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Duplicate Mythic Council" }),
    );
    expect(planDuplicate).toHaveBeenCalledWith({ id: "p1" });
    // list() is re-queried: once on mount, once after duplicating.
    await waitFor(() => expect(planList).toHaveBeenCalledTimes(2));
  });
});
