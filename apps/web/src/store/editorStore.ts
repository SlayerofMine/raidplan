import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Background, PlanObject } from "@raidplan/shared";
import {
  fitView,
  screenToNative,
  zoomAt,
  type Point,
  type Size,
  type View,
} from "../editor/canvas/coords";
import { ARENA_BACKGROUND } from "../assets/background";
import { createIconObject } from "./objectFactory";

/**
 * The editor store (plan §1.4). Holds a **normalized** object map plus an
 * insertion-ordered id list (id list doubles as z-order for Phase 1), the
 * current selection, and the ephemeral **view** (pan/zoom) — kept out of the
 * plan document per plan §6, since it must never be persisted with the plan.
 *
 * Actions are the only way to mutate state; components subscribe with narrow
 * selectors so, e.g., moving one object won't re-render the palette.
 */
export interface EditorState {
  // --- document ---
  background: Background;
  objects: Record<string, PlanObject>;
  objectIds: string[];
  selectedId: string | null;

  // --- view (not persisted) ---
  view: View;
  stageSize: Size;

  // --- actions ---
  addIcon: (iconId: string, native?: Point) => string;
  moveObject: (id: string, x: number, y: number) => void;
  selectObject: (id: string | null) => void;
  deleteObject: (id: string) => void;
  deleteSelected: () => void;
  setView: (view: View) => void;
  setStageSize: (size: Size) => void;
  fitToStage: () => void;
  zoomAtPoint: (focal: Point, factor: number) => void;
  reset: () => void;
}

const INITIAL_VIEW: View = { scale: 1, x: 0, y: 0 };
const INITIAL_STAGE_SIZE: Size = { width: 0, height: 0 };

export const useEditorStore = create<EditorState>()(
  immer((set, get) => ({
    background: ARENA_BACKGROUND,
    objects: {},
    objectIds: [],
    selectedId: null,
    view: INITIAL_VIEW,
    stageSize: INITIAL_STAGE_SIZE,

    addIcon: (iconId, native) => {
      const { stageSize, view, background, objectIds } = get();
      // Drop point: the explicit native coord (drag-and-drop), else the centre
      // of what's currently visible, else the background centre before measure.
      const center =
        native ??
        (stageSize.width > 0 && stageSize.height > 0
          ? screenToNative(
              { x: stageSize.width / 2, y: stageSize.height / 2 },
              view,
            )
          : { x: background.width / 2, y: background.height / 2 });

      const object = createIconObject({
        iconId,
        center,
        z: objectIds.length,
      });

      set((s) => {
        s.objects[object.id] = object;
        s.objectIds.push(object.id);
        s.selectedId = object.id;
      });
      return object.id;
    },

    moveObject: (id, x, y) =>
      set((s) => {
        const object = s.objects[id];
        if (object) {
          object.base.x = x;
          object.base.y = y;
        }
      }),

    selectObject: (id) =>
      set((s) => {
        s.selectedId = id;
      }),

    deleteObject: (id) =>
      set((s) => {
        if (!s.objects[id]) return;
        delete s.objects[id];
        s.objectIds = s.objectIds.filter((oid) => oid !== id);
        if (s.selectedId === id) s.selectedId = null;
      }),

    deleteSelected: () => {
      const id = get().selectedId;
      if (id) get().deleteObject(id);
    },

    setView: (view) =>
      set((s) => {
        s.view = view;
      }),

    setStageSize: (size) =>
      set((s) => {
        s.stageSize = size;
      }),

    fitToStage: () => {
      const { background, stageSize } = get();
      if (stageSize.width <= 0 || stageSize.height <= 0) return;
      set((s) => {
        s.view = fitView(background, stageSize);
      });
    },

    zoomAtPoint: (focal, factor) =>
      set((s) => {
        s.view = zoomAt(s.view, focal, factor);
      }),

    reset: () =>
      set((s) => {
        s.objects = {};
        s.objectIds = [];
        s.selectedId = null;
        s.view = INITIAL_VIEW;
      }),
  })),
);
