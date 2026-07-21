import { create } from "zustand";
import { temporal } from "zundo";
import { shallow } from "zustand/shallow";
import { immer } from "zustand/middleware/immer";
import {
  resolveObjectState,
  type Anim,
  type AttackDef,
  type AttackInstance,
  type Background,
  type ObjectBase,
  type ObjectState,
  type ObjectStyle,
  type ObjectType,
  type Plan,
  type PlanObject,
  type ShapeKind,
  type Step,
  type StepOverride,
} from "@raidplan/shared";
import { DEFAULT_BACKGROUND } from "@raidplan/shared";
import { getIconById } from "@raidplan/shared";
import { nextAnimId, nextAttackId, nextGroupId, nextStepId } from "./ids";
import {
  fitView,
  screenToNative,
  zoomAt,
  type Point,
  type Size,
  type View,
} from "../editor/canvas/coords";
import { DEFAULT_GRID_SIZE, snapValue } from "../editor/canvas/snapping";
import {
  createIconObject,
  createObject,
  createTether,
  TETHER_DEFAULT_TINT,
} from "./objectFactory";
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
  /**
   * Which "slide" is being edited: `BASE_STEP_INDEX` (-1) is the starting
   * layout (writes land on `object.base`); `0..steps.length-1` is a step
   * (writes land in that step's `overrides`). Ephemeral, like the selection.
   */
  currentStepIndex: number;

  // --- creation ---
  addIcon: (iconId: string, native?: Point) => string;
  /** `native` places it at a point (a palette drop); otherwise the view centre. */
  addPrimitive: (type: ObjectType, shape?: ShapeKind, native?: Point) => string;
  /** Link two existing objects with a tether. Returns its id, or undefined. */
  addTether: (fromId: string, toId: string) => string | undefined;

  // --- mutation ---
  updateObject: (id: string, patch: Partial<ObjectBase>) => void;
  /** Merge a patch into an object's visual style (fill/outline/edge/line). */
  updateStyle: (id: string, patch: Partial<ObjectStyle>) => void;
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
  /**
   * Placed attacks currently selected (plan §18.3). Kept beside `selectedIds`
   * rather than mixed into it: an attack is a reference, not an object, and the
   * two are never selected together — picking one clears the other.
   */
  selectedAttackIds: string[];
  selectAttack: (ids: string[]) => void;
  /**
   * Tie the current selection together so it selects and transforms as one
   * (plan §18.1). Returns the new group id, or undefined for a selection of
   * fewer than two. Members already in other groups are merged into this one.
   */
  groupSelected: () => string | undefined;
  /** Dissolve the groups any selected object belongs to. */
  ungroupSelected: () => void;

  // --- steps (plan §3.2) ---
  addStep: () => string;
  duplicateStep: (index: number) => void;
  deleteStep: (index: number) => void;
  moveStep: (from: number, to: number) => void;
  selectStep: (index: number) => void;
  setStepName: (index: number, name: string) => void;

  // --- animations (plan §3.4) ---
  addAnimation: (stepIndex: number, objectId: string) => string | undefined;
  updateAnimation: (
    stepIndex: number,
    animId: string,
    patch: Partial<Omit<Anim, "id">>,
  ) => void;
  deleteAnimation: (stepIndex: number, animId: string) => void;

  /**
   * Definitions for the attacks this plan can use, keyed by id (plan §17).
   * Ephemeral: fetched per plan, never part of the document, undo or autosave —
   * a plan references attacks, it doesn't own them. Shared by the canvas preview
   * and the WebM export so both expand from the same defs.
   */
  attackDefs: Record<string, AttackDef>;
  setAttackDefs: (defs: Record<string, AttackDef>) => void;

  // --- placed attacks (plan §17) ---
  /**
   * Drop a pre-designed attack on the board at a point (plan §18.3).
   *
   * Placement belongs to the plan, so this works from the base layout as well as
   * from a step. *When* it fires is a separate question: it's pinned to the step
   * being edited, or to the first one when you're laying out the board — and a
   * plan with no steps gets one, because an attack that never fires is furniture.
   */
  addAttack: (
    attackId: string,
    at: { x: number; y: number },
    stepId?: string,
  ) => string | undefined;
  /** Retune a placed attack — position, rotation, scale, step or start offset. */
  updateAttack: (
    instanceId: string,
    patch: Partial<Omit<AttackInstance, "id" | "attackId">>,
  ) => void;
  removeAttack: (instanceId: string) => void;

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

/** `currentStepIndex` for "the starting layout", before any step runs. */
export const BASE_STEP_INDEX = -1;

/**
 * The properties a step can override (they match `StepOverrideSchema`). Anything
 * else — tint, label, z — is step-independent and always lives on the base.
 */
const OVERRIDABLE_KEYS = [
  "x",
  "y",
  "w",
  "h",
  "rotation",
  "opacity",
  "visible",
] as const satisfies readonly (keyof StepOverride)[];

/** Split a property patch into the step-overridable part and the base-only part. */
function splitPatch(patch: Partial<ObjectBase>): {
  override: StepOverride;
  baseOnly: Partial<ObjectBase>;
} {
  const override: Record<string, unknown> = {};
  const baseOnly: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((OVERRIDABLE_KEYS as readonly string[]).includes(key)) {
      override[key] = value;
    } else {
      baseOnly[key] = value;
    }
  }
  return { override, baseOnly };
}

/**
 * Write transform-ish properties to wherever the current step says they belong:
 * the base layout, or the current step's overrides. This is the single choke
 * point that makes "the editor edits the end state" true (plan §5).
 */
function writeOverridable(
  s: EditorState,
  id: string,
  override: StepOverride,
): void {
  if (Object.keys(override).length === 0) return;
  if (s.currentStepIndex === BASE_STEP_INDEX) {
    const object = s.objects[id];
    if (object) Object.assign(object.base, override);
    return;
  }
  const step = s.steps[s.currentStepIndex];
  if (!step) return;
  step.overrides[id] = { ...step.overrides[id], ...override };
}

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

/**
 * Expand ids to whole groups: selecting any member selects them all (plan
 * §18.1). Returned in document order so a selection is deterministic. This is
 * the single choke point that makes grouping work for clicks, marquee sweeps
 * and select-all alike — and it's why the existing multi-node transformer
 * transforms a group rigidly with no extra maths.
 */
function withGroupMembers(
  objects: Record<string, PlanObject>,
  objectIds: string[],
  ids: string[],
): string[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const groupId = objects[id]?.groupId;
    if (groupId) groups.add(groupId);
  }
  const wanted = new Set(ids.filter((id) => objects[id]));
  if (groups.size > 0) {
    for (const id of objectIds) {
      const groupId = objects[id]?.groupId;
      if (groupId && groups.has(groupId)) wanted.add(id);
    }
  }
  return objectIds.filter((id) => wanted.has(id));
}

/** Offset (native px) applied to duplicated/pasted copies so they're visible. */
const CLONE_OFFSET = 20;

/**
 * Copy an object under a fresh id, nudged by `CLONE_OFFSET`. Shared by
 * duplicate and paste so both produce identical results.
 *
 * `appearance` is the source's *resolved* state on the current step, so a copy
 * lands where the original visibly is rather than at its base — the two differ
 * as soon as a step overrides the original.
 */
function cloneObject(
  source: PlanObject,
  z: number,
  appearance: ObjectState,
): PlanObject {
  const clone = createObject({
    type: source.type,
    center: {
      x: appearance.x + appearance.w / 2 + CLONE_OFFSET,
      y: appearance.y + appearance.h / 2 + CLONE_OFFSET,
    },
    z,
    size: { w: appearance.w, h: appearance.h },
    ...(source.iconId ? { iconId: source.iconId } : {}),
    ...(source.shape ? { shape: source.shape } : {}),
    ...(source.base.tint ? { tint: source.base.tint } : {}),
    ...(source.base.label ? { label: source.base.label } : {}),
  });
  // Carry over the properties the factory doesn't take.
  clone.base.rotation = appearance.rotation;
  clone.base.opacity = appearance.opacity;
  clone.base.visible = appearance.visible;
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
      encounterId: undefined,
      attacks: [],
      attackDefs: {},
      background: DEFAULT_BACKGROUND,
      objects: {},
      objectIds: [],
      steps: [],
      selectedIds: [],
      selectedAttackIds: [],
      view: INITIAL_VIEW,
      stageSize: INITIAL_STAGE_SIZE,
      snapEnabled: false,
      gridSize: DEFAULT_GRID_SIZE,
      clipboard: [],
      currentStepIndex: BASE_STEP_INDEX,

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

      addPrimitive: (type, shape, native) => {
        const state = get();
        const object = createObject({
          type,
          center: native ?? viewCentreNative(state),
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

      addTether: (fromId, toId) => {
        const state = get();
        // Both endpoints must exist and be distinct — a tether needs two objects.
        if (!state.objects[fromId] || !state.objects[toId] || fromId === toId) {
          return undefined;
        }
        const object = createTether({
          fromId,
          toId,
          z: state.objectIds.length,
          tint: TETHER_DEFAULT_TINT,
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
          const { override, baseOnly } = splitPatch(patch);
          // tint/label/z are step-independent; transforms follow the step.
          if (Object.keys(baseOnly).length > 0) {
            Object.assign(object.base, baseOnly);
          }
          writeOverridable(s, id, override);
        }),

      updateStyle: (id, patch) =>
        set((s) => {
          const object = s.objects[id];
          if (!object) return;
          // Style is step-independent (like tint) — it lives on the object,
          // never in a step's overrides. Merge so toggles compose.
          object.style = { ...object.style, ...patch };
        }),

      moveObject: (id, x, y) =>
        set((s) => {
          const object = s.objects[id];
          if (!object || object.locked) return;
          const grid = s.snapEnabled ? s.gridSize : 0;
          writeOverridable(s, id, {
            x: snapValue(x, grid),
            y: snapValue(y, grid),
          });
        }),

      nudgeSelected: (dx, dy, big = false) =>
        set((s) => {
          const step = s.snapEnabled ? s.gridSize : big ? 10 : 1;
          for (const id of s.selectedIds) {
            const object = s.objects[id];
            if (!object || object.locked) continue;
            // Nudge from where the object *currently appears*, which on a step
            // is its resolved position, not its base.
            const current = resolveObjectState(
              object,
              s.steps,
              s.currentStepIndex,
            );
            writeOverridable(s, id, {
              x: current.x + dx * step,
              y: current.y + dy * step,
            });
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
          // Deleting an endpoint deletes any tether hanging off it — a tether
          // with a missing end has nothing to draw and would just be dead data.
          for (const id of s.objectIds) {
            const object = s.objects[id];
            if (
              object?.type === "tether" &&
              (doomed.has(object.fromId ?? "") || doomed.has(object.toId ?? ""))
            ) {
              doomed.add(id);
            }
          }
          for (const id of doomed) delete s.objects[id];
          s.objectIds = s.objectIds.filter((id) => !doomed.has(id));
          s.selectedIds = s.selectedIds.filter((id) => !doomed.has(id));
          // Don't leave steps referencing an object that no longer exists.
          // Resolution tolerates stale overrides, but they'd resurrect on undo
          // and bloat every save.
          for (const step of s.steps) {
            for (const id of doomed) delete step.overrides[id];
            step.animations = step.animations.filter(
              (a) => !doomed.has(a.objectId),
            );
          }
          reindexZ(s);
        }),

      deleteSelected: () => {
        const { selectedIds, selectedAttackIds } = get();
        // Delete removes whichever kind is selected — they're never both.
        for (const id of selectedAttackIds) get().removeAttack(id);
        if (selectedAttackIds.length > 0) {
          set((s) => {
            s.selectedAttackIds = [];
          });
        }
        if (selectedIds.length > 0) get().deleteObjects(selectedIds);
      },

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
        const { objectIds, steps, currentStepIndex } = get();
        const startZ = objectIds.length;
        const clones = sources.map((source, i) =>
          cloneObject(
            source,
            startZ + i,
            resolveObjectState(source, steps, currentStepIndex),
          ),
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
          s.selectedIds = withGroupMembers(s.objects, s.objectIds, ids);
          s.selectedAttackIds = [];
        }),

      selectAttack: (ids) =>
        set((s) => {
          s.selectedAttackIds = ids;
          s.selectedIds = [];
        }),
      toggleSelect: (id) =>
        set((s) => {
          if (!s.objects[id]) return;
          // A group toggles as a unit, never member by member.
          const members = withGroupMembers(s.objects, s.objectIds, [id]);
          const selected = new Set(s.selectedIds);
          s.selectedIds = members.some((m) => selected.has(m))
            ? s.selectedIds.filter((x) => !members.includes(x))
            : [...s.selectedIds, ...members.filter((m) => !selected.has(m))];
        }),
      selectAll: () =>
        set((s) => {
          s.selectedIds = [...s.objectIds];
          s.selectedAttackIds = [];
        }),
      clearSelection: () =>
        set((s) => {
          s.selectedIds = [];
          s.selectedAttackIds = [];
        }),

      groupSelected: () => {
        if (get().selectedIds.length < 2) return undefined;
        const groupId = nextGroupId();
        set((s) => {
          for (const id of s.selectedIds) {
            const object = s.objects[id];
            if (object) object.groupId = groupId;
          }
        });
        return groupId;
      },

      ungroupSelected: () =>
        set((s) => {
          const groups = new Set<string>();
          for (const id of s.selectedIds) {
            const groupId = s.objects[id]?.groupId;
            if (groupId) groups.add(groupId);
          }
          for (const id of s.objectIds) {
            const object = s.objects[id];
            if (object?.groupId && groups.has(object.groupId)) {
              delete object.groupId;
            }
          }
        }),

      addStep: () => {
        const step: Step = {
          id: nextStepId(),
          name: `Step ${get().steps.length + 1}`,
          overrides: {},
          animations: [],
        };
        set((s) => {
          s.steps.push(step);
          s.currentStepIndex = s.steps.length - 1;
        });
        return step.id;
      },

      duplicateStep: (index) => {
        // Read through `get()`, never from the immer draft: drafts are Proxies
        // and `structuredClone` throws on them.
        const source = get().steps[index];
        if (!source) return;
        const copy: Step = {
          id: nextStepId(),
          name: `${source.name ?? `Step ${index + 1}`} copy`,
          overrides: structuredClone(source.overrides),
          // Animations are copied, but each needs its own identity.
          animations: source.animations.map((a) => ({
            ...structuredClone(a),
            id: nextAnimId(),
          })),
          ...(source.autoAdvanceMs !== undefined
            ? { autoAdvanceMs: source.autoAdvanceMs }
            : {}),
        };
        set((s) => {
          s.steps.splice(index + 1, 0, copy);
          s.currentStepIndex = index + 1;
        });
      },

      deleteStep: (index) =>
        set((s) => {
          const doomed = s.steps[index];
          if (!doomed) return;
          s.steps.splice(index, 1);
          // An attack fires on exactly one step; without it there is no moment
          // for it to happen, so it goes too (undo brings both back).
          s.attacks = s.attacks.filter((a) => a.stepId !== doomed.id);
          // Stay in range; fall back to the base layout when the last step goes.
          s.currentStepIndex = Math.min(s.currentStepIndex, s.steps.length - 1);
        }),

      moveStep: (from, to) =>
        set((s) => {
          if (!s.steps[from] || to < 0 || to >= s.steps.length) return;
          const [moved] = s.steps.splice(from, 1);
          if (!moved) return;
          s.steps.splice(to, 0, moved);
          s.currentStepIndex = to;
        }),

      selectStep: (index) =>
        set((s) => {
          s.currentStepIndex = Math.max(
            BASE_STEP_INDEX,
            Math.min(index, s.steps.length - 1),
          );
        }),

      setStepName: (index, name) =>
        set((s) => {
          const step = s.steps[index];
          if (step) step.name = name;
        }),

      addAnimation: (stepIndex, objectId) => {
        const { steps, objects } = get();
        if (!steps[stepIndex] || !objects[objectId]) return undefined;
        const anim: Anim = {
          id: nextAnimId(),
          objectId,
          kind: "motion",
          effect: "move",
          trigger: "onEnter",
          delayMs: 0,
          durationMs: 500,
          easing: "power2.out",
        };
        set((s) => {
          s.steps[stepIndex]?.animations.push(anim);
        });
        return anim.id;
      },

      updateAnimation: (stepIndex, animId, patch) =>
        set((s) => {
          const anim = s.steps[stepIndex]?.animations.find(
            (a) => a.id === animId,
          );
          if (anim) Object.assign(anim, patch);
        }),

      deleteAnimation: (stepIndex, animId) =>
        set((s) => {
          const step = s.steps[stepIndex];
          if (!step) return;
          step.animations = step.animations.filter((a) => a.id !== animId);
        }),

      setAttackDefs: (defs) =>
        set((s) => {
          s.attackDefs = defs;
        }),

      addAttack: (attackId, at, stepId) => {
        const state = get();
        // Laying out the board is a fine time to place an attack; it fires on
        // the step you're editing, else the first one, creating it if need be.
        const firesOn =
          stepId ??
          state.steps[state.currentStepIndex]?.id ??
          state.steps[0]?.id ??
          get().addStep();
        // The def's default size is the size it was drawn at; centre it on the
        // drop point so the attack lands where you aimed (plan §18.2).
        const size = state.attackDefs[attackId]?.defaultSize ?? {
          w: 400,
          h: 400,
        };
        const instance: AttackInstance = {
          id: nextAttackId(),
          attackId,
          stepId: firesOn,
          x: at.x - size.w / 2,
          y: at.y - size.h / 2,
          w: size.w,
          h: size.h,
          rotation: 0,
          startMs: 0,
          args: {},
        };
        set((s) => {
          s.attacks.push(instance);
          s.selectedAttackIds = [instance.id];
          s.selectedIds = [];
        });
        return instance.id;
      },

      updateAttack: (instanceId, patch) =>
        set((s) => {
          const instance = s.attacks.find((a) => a.id === instanceId);
          if (instance) Object.assign(instance, patch);
        }),

      removeAttack: (instanceId) =>
        set((s) => {
          s.attacks = s.attacks.filter((a) => a.id !== instanceId);
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
          s.encounterId = doc.encounterId;
          s.background = doc.background;
          s.objects = doc.objects;
          s.objectIds = doc.objectIds;
          s.attacks = doc.attacks;
          s.steps = doc.steps;
          s.selectedIds = [];
          s.selectedAttackIds = [];
          s.currentStepIndex = BASE_STEP_INDEX;
        }),

      getPlan: () => toPlan(get()),

      reset: () =>
        set((s) => {
          s.objects = {};
          s.objectIds = [];
          s.attacks = [];
          s.selectedIds = [];
          s.selectedAttackIds = [];
          s.title = "Untitled plan";
          s.background = DEFAULT_BACKGROUND;
          s.steps = [];
          s.view = INITIAL_VIEW;
          s.clipboard = [];
          s.currentStepIndex = BASE_STEP_INDEX;
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
        attacks: state.attacks,
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
