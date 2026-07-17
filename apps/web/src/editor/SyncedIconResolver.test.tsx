import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { SCHEMA_VERSION, type Plan, type PlanObject } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { SyncedIconResolver } from "./SyncedIconResolver";
import { clearSyncedIconUrls, useSyncedIcons } from "./iconSrc";
import { resolveIcons } from "../api/iconCatalog";

vi.mock("../api/iconCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/iconCatalog")>();
  return { ...actual, resolveIcons: vi.fn() };
});
const mockResolve = vi.mocked(resolveIcons);

const token = (id: string, iconId: string): PlanObject => ({
  id,
  type: "token",
  iconId,
  base: {
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    rotation: 0,
    opacity: 1,
    z: 0,
    visible: true,
  },
});

const plan = (objects: PlanObject[]): Plan => ({
  id: "p",
  title: "T",
  raid: "",
  background: { assetId: "arena", width: 1600, height: 900 },
  objects,
  steps: [],
  schemaVersion: SCHEMA_VERSION,
});

beforeEach(() => {
  useEditorStore.getState().reset();
  clearSyncedIconUrls();
  mockResolve.mockReset();
});

describe("SyncedIconResolver", () => {
  it("resolves only the synced ids a loaded plan references", async () => {
    mockResolve.mockResolvedValueOnce([
      {
        id: "spell_fire_fireball02",
        displayName: "Fire",
        category: "spell",
        url56: "/icons/x_56.webp",
        url112: "/icons/x_112.webp",
      },
    ]);
    useEditorStore
      .getState()
      .loadPlan(
        plan([token("a", "marker-1"), token("b", "spell_fire_fireball02")]),
      );

    render(<SyncedIconResolver />);

    // The bundled marker resolves from the manifest and is not requested.
    await waitFor(() =>
      expect(mockResolve).toHaveBeenCalledWith(["spell_fire_fireball02"]),
    );
    // The canvas draws at 112px, so the 112 URL is what gets registered.
    await waitFor(() =>
      expect(useSyncedIcons.getState().urls["spell_fire_fireball02"]).toBe(
        "/icons/x_112.webp",
      ),
    );
  });

  it("makes no request when every icon is bundled", () => {
    useEditorStore.getState().loadPlan(plan([token("a", "marker-1")]));
    render(<SyncedIconResolver />);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("does not re-request an id already resolved this session", () => {
    useSyncedIcons
      .getState()
      .register([{ id: "spell_fire_fireball02", url: "/icons/known_56.webp" }]);
    useEditorStore
      .getState()
      .loadPlan(plan([token("b", "spell_fire_fireball02")]));

    render(<SyncedIconResolver />);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("leaves tokens unresolved rather than throwing when resolve fails", async () => {
    mockResolve.mockRejectedValueOnce(new Error("offline"));
    useEditorStore
      .getState()
      .loadPlan(plan([token("b", "spell_fire_fireball02")]));

    render(<SyncedIconResolver />);
    await waitFor(() => expect(mockResolve).toHaveBeenCalled());
    expect(
      useSyncedIcons.getState().urls["spell_fire_fireball02"],
    ).toBeUndefined();
  });
});
