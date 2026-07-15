import { create } from "zustand";
import { temporal } from "zundo";
import { shallow } from "zustand/shallow";
import { immer } from "zustand/middleware/immer";
import type {
  Background,
  ObjectBase,
  ObjectType,
  Plan,
  PlanObject,
  ShapeKind,
} from "@raidplan/shared";
import { DEFAULT_BACKGROUND } from "../assets/backgrounds";
import { getIconById } from "../assets/icons";
import {
  fitView,
  screenToNative,
  zoomAt,
  type Point,
  type Size,
  type View,
} from "../editor/canvas/coords";
import { DEFAULT_GRID_SIZE, snapValue } from "../editor/canvas/snapping";
import { createIconObject, createObject } from "./objectFactory";
import { fromPlan, toPlan, type PlanDoc } from "./planSerialization";

/**
 * The editor store (plan §2). `PlanDoc` fields are the **document** — persisted
 * and undoable; `selectedIds`/`view`/`stageSize`/grid settings are ephemeral and
 * deliberately excluded from history (see the `partialize` below) so undo never
 * fights the camera or the selection.
 *
 * Objects stay normalized (map + ordered ids) for fine-grained subscriptions;
 * `objectIds` order *is* the z-order, and `base.z` is kept in sync with it.
 */
export interface EditorState extends PlanDoc {
  selectedIds: string[];
  view: View;
  stageSize: Size;
  snapEnabled: boolean;
  gridSize: number;
  /** In-app clipboard for copy/paste — never persisted or undone. */
  clipboard: PlanObject[];

  // --- creation ---
  addIcon: (iconId: string, native?: Point) => string;
  addPrimitive: (type: ObjectType, shape?: ShapeKind) => string;

  // --- mutation ---
  updateObject: (id: string, patch: Partial<ObjectBase>) => void;
  moveObject: (id: string, x: number, y: number) => void;
  nudgeSelected: (dx: number, dy: number, big?: boolean) => void;
  setLocked: (id: string, locked: boolean) => void;
  deleteObjects: (ids: string[]) => void;
  deleteSelected: () => void;
  duplicateSelected: () => string[];
  copySelected: () => void;
  paste: () => string[];
  /** Append copies of `sources` and select them. Backs duplicate and paste. */
  addClones: (sources: PlanObject[]) => string[];

  // --- ordering ---
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;

  // --- selection ---
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  // --- document ---
  setTitle: (title: string) => void;
  setBackground: (background: Background) => void;
  loadPlan: (plan: Plan) => void;
  getPlan: () => Plan;
  reset: () => void;

  // --- view / grid ---
  setView: (view: View) => void;
  setStageSize: (size: Size) => void;
  fitToStage: () => void;
  zoomAtPoint: (focal: Point, factor: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
}

const INITIAL_VIEW: View = { scale: 1, x: 0, y: 0 };
const INITIAL_STAGE_SIZE: Size = { width: 0, height: 0 };

/** Keep `base.z` aligned with the id order after any structural change. */
function reindexZ(s: {
  objects: Record<string, PlanObject>;
  objectIds: string[];
}) {
  s.objectIds.forEach((id, index) => {
    const object = s.objects[id];
    if (object) object.base.z = index;
  });
}

/** Offset (native px) applied to duplicated/pasted copies so they're visible. */
const CLONE_OFFSET = 20;

/**
 * Copy an object under a fresh id, nudged by `CLONE_OFFSET`. Shared by
 * duplicate and paste so both produce identical results.
 */
function cloneObject(source: PlanObject, z: number): PlanObject {
  const clone = createObject({
    type: source.type,
    center: {
      x: source.base.x + source.base.w / 2 + CLONE_OFFSET,
      y: source.base.y + source.base.h / 2 + CLONE_OFFSET,
    },
    z,
    size: { w: source.base.w, h: source.base.h },
    ...(source.iconId ? { iconId: source.iconId } : {}),
    ...(source.shape ? { shape: source.shape } : {}),
    ...(source.base.tint ? { tint: source.base.tint } : {}),
    ...(source.base.label ? { label: source.base.label } : {}),
  });
  // Carry over the properties the factory doesn't take.
  clone.base.rotation = source.base.rotation;
  clone.base.opacity = source.base.opacity;
  clone.base.visible = source.base.visible;
  return clone;
}

/** Move an id within the order array by `delta`, clamped to the ends. */
function reorder(objectIds: string[], id: string, delta: number): string[] {
  const from = objectIds.indexOf(id);
  if (from === -1) return objectIds;
  const to = Math.min(objectIds.length - 1, Math.max(0, from + delta));
  if (to === from) return objectIds;
  const next = [...objectIds];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export const useEditorStore = create<EditorState>()(
  temporal(
    immer((set, get) => ({
      id: "local",
      title: "Untitled plan",
      raid: "",
      background: DEFAULT_BACKGROUND,
      objects: {},
      objectIds: [],
      steps: [],
      selectedIds: [],
      view: INITIAL_VIEW,
      stageSize: INITIAL_STAGE_SIZE,
      snapEnabled: false,
      gridSize: DEFAULT_GRID_SIZE,
      clipboard: [],

      addIcon: (iconId, native) => {
        const state = get();
        const icon = getIconById(iconId);
        const object = createIconObject({
          iconId,
          center: native ?? viewCentreNative(state),
          z: state.objectIds.length,
          ...(icon?.tint ? { tint: icon.tint } : {}),
        });
        set((s) => {
          s.objects[object.id] = object;
          s.objectIds.push(object.id);
          s.selectedIds = [object.id];
        });
        return object.id;
      },

      addPrimitive: (type, shape) => {
        const state = get();
        const object = createObject({
          type,
          center: viewCentreNative(state),
          z: state.objectIds.length,
          ...(shape ? { shape } : {}),
          ...(type === "text" ? { label: "Text" } : {}),
          ...(type === "shape" || type === "arrow" ? { tint: "#4f9dff" } : {}),
        });
        set((s) => {
          s.objects[object.id] = object;
          s.objectIds.push(object.id);
          s.selectedIds = [object.id];
        });
        return object.id;
      },

      updateObject: (id, patch) =>
        set((s) => {
          const object = s.objects[id];
          if (!object) return;
          Object.assign(object.base, patch);
        }),

      moveObject: (id, x, y) =>
        set((s) => {
          const object = s.objects[id];
          if (!object || object.locked) return;
          const grid = s.snapEnabled ? s.gridSize : 0;
          object.base.x = snapValue(x, grid);
          object.base.y = snapValue(y, grid);
        }),

      nudgeSelected: (dx, dy, big = false) =>
        set((s) => {
          const step = s.snapEnabled ? s.gridSize : big ? 10 : 1;
          for (const id of s.selectedIds) {
            const object = s.objects[id];
            if (!object || object.locked) continue;
            object.base.x += dx * step;
            object.base.y += dy * step;
          }
        }),

      setLocked: (id, locked) =>
        set((s) => {
          const object = s.objects[id];
          if (object) object.locked = locked;
        }),

      deleteObjects: (ids) =>
        set((s) => {
          const doomed = new Set(ids.filter((id) => s.objects[id]));
          if (doomed.size === 0) return;
          for (const id of doomed) delete s.objects[id];
          s.objectIds = s.objectIds.filter((id) => !doomed.has(id));
          s.selectedIds = s.selectedIds.filter((id) => !doomed.has(id));
          reindexZ(s);
        }),

      deleteSelected: () => get().deleteObjects(get().selectedIds),

      duplicateSelected: () => {
        const state = get();
        // Clone in z-order so copies keep their relative stacking.
        const sources = state.objectIds
          .filter((id) => state.selectedIds.includes(id))
          .map((id) => state.objects[id])
          .filter((o): o is PlanObject => o !== undefined);
        return get().addClones(sources);
      },

      copySelected: () => {
        const state = get();
        const copied = state.objectIds
          .filter((id) => state.selectedIds.includes(id))
          .map((id) => state.objects[id])
          .filter((o): o is PlanObject => o !== undefined);
        set((s) => {
          // Snapshot, so later edits to the originals don't mutate the clipboard.
          s.clipboard = structuredClone(copied);
        });
      },

      paste: () => get().addClones(get().clipboard),

      addClones: (sources) => {
        if (sources.length === 0) return [];
        const startZ = get().objectIds.length;
        const clones = sources.map((source, i) =>
          cloneObject(source, startZ + i),
        );
        set((s) => {
          for (const clone of clones) {
            s.objects[clone.id] = clone;
            s.objectIds.push(clone.id);
          }
          s.selectedIds = clones.map((c) => c.id);
          reindexZ(s);
        });
        return clones.map((c) => c.id);
      },

      bringForward: (id) =>
        set((s) => {
          s.objectIds = reorder(s.objectIds, id, 1);
          reindexZ(s);
        }),
      sendBackward: (id) =>
        set((s) => {
          s.objectIds = reorder(s.objectIds, id, -1);
          reindexZ(s);
        }),
      bringToFront: (id) =>
        set((s) => {
          s.objectIds = reorder(s.objectIds, id, s.objectIds.length);
          reindexZ(s);
        }),
      sendToBack: (id) =>
        set((s) => {
          s.objectIds = reorder(s.objectIds, id, -s.objectIds.length);
          reindexZ(s);
        }),

      select: (ids) =>
        set((s) => {
          s.selectedIds = ids.filter((id) => s.objects[id]);
        }),
      toggleSelect: (id) =>
        set((s) => {
          if (!s.objects[id]) return;
          s.selectedIds = s.selectedIds.includes(id)
            ? s.selectedIds.filter((x) => x !== id)
            : [...s.selectedIds, id];
        }),
      selectAll: () =>
        set((s) => {
          s.selectedIds = [...s.objectIds];
        }),
      clearSelection: () =>
        set((s) => {
          s.selectedIds = [];
        }),

      setTitle: (title) =>
        set((s) => {
          s.title = title;
        }),
      setBackground: (background) =>
        set((s) => {
          s.background = background;
        }),

      loadPlan: (plan) =>
        set((s) => {
          const doc = fromPlan(plan);
          s.id = doc.id;
          s.title = doc.title;
          s.raid = doc.raid;
          s.background = doc.background;
          s.objects = doc.objects;
          s.objectIds = doc.objectIds;
          s.steps = doc.steps;
          s.selectedIds = [];
        }),

      getPlan: () => toPlan(get()),

      reset: () =>
        set((s) => {
          s.objects = {};
          s.objectIds = [];
          s.selectedIds = [];
          s.title = "Untitled plan";
          s.background = DEFAULT_BACKGROUND;
          s.steps = [];
          s.view = INITIAL_VIEW;
          s.clipboard = [];
        }),

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
      setSnapEnabled: (enabled) =>
        set((s) => {
          s.snapEnabled = enabled;
        }),
    })),
    {
      // Only the document is undoable — never the camera or the selection.
      partialize: (state): PlanDoc => ({
        id: state.id,
        title: state.title,
        raid: state.raid,
        background: state.background,
        objects: state.objects,
        objectIds: state.objectIds,
        steps: state.steps,
      }),
      // Immer keeps untouched slices referentially stable, so a shallow compare
      // means selection/camera changes never create a history entry.
      equality: shallow,
      limit: 100,
    },
  ),
);

/** The native-space point at the centre of what's currently on screen. */
function viewCentreNative(state: {
  stageSize: Size;
  view: View;
  background: Background;
}): Point {
  const { stageSize, view, background } = state;
  if (stageSize.width > 0 && stageSize.height > 0) {
    return screenToNative(
      { x: stageSize.width / 2, y: stageSize.height / 2 },
      view,
    );
  }
  return { x: background.width / 2, y: background.height / 2 };
}

/** Undo/redo history controls (zundo). Kept out of the document store's API. */
export const temporalStore = useEditorStore.temporal;

/** Drop history — used after loading a plan so undo can't cross the load. */
export function clearHistory(): void {
  temporalStore.getState().clear();
}
