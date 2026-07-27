import { create } from "zustand";
import { temporal } from "zundo";
import { shallow } from "zustand/shallow";
import { immer } from "zustand/middleware/immer";
import {
  attackSlots,
  attackZ,
  isFollowing,
  isOnSlide,
  makeFirstSlide,
  objectsOnSlide,
  settledStates,
  resolveObjectState,
  seedState,
  type Anim,
  type AttackDef,
  type AttackInstance,
  type Background,
  type Follow,
  type ObjectBase,
  type ObjectState,
  type ObjectStyle,
  type ObjectType,
  type Plan,
  type PlanObject,
  type ShapeKind,
  type Slide,
  type SlideState,
} from "@raidplan/shared";
import { DEFAULT_BACKGROUND } from "@raidplan/shared";
import { getIconById } from "@raidplan/shared";
import { nextAnimId, nextAttackId, nextGroupId, nextSlideId } from "./ids";
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
import {
  fromPlan,
  pickPlanDoc,
  toPlan,
  type PlanDoc,
} from "./planSerialization";

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
   * Which slide is being edited — `0..slides.length-1`, and never out of that
   * range, because there is always at least one slide and no "before the first
   * one" layout to sit in. Transform writes land in this slide's `states`.
   * Ephemeral, like the selection.
   */
  currentSlideIndex: number;
  /**
   * Do all the slides share one cast? `false` — a plan — means each slide owns
   * its own objects, so adding one puts it on the slide being edited and
   * deleting one takes it out of that scene alone.
   *
   * The attack designer sets it `true`. An {@link AttackDef} is genuinely
   * *one* thing in two states — a start shape and what its animations turn it
   * into — which `defToPlan` lays out as two slides. They are two views of the
   * same scene, not two scenes, so a part drawn on either belongs to both.
   *
   * Ephemeral: a property of which editor is open, never of the document.
   */
  sharedCast: boolean;
  setSharedCast: (shared: boolean) => void;

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
  /**
   * Say what an object follows — its origin pinned to one object, its direction
   * aimed at another (plan §18.17). Slide-independent, like style and lock: what
   * a thing follows is a fact about the thing, not about the moment.
   */
  setFollow: (id: string, follow: Follow | undefined) => void;
  deleteObjects: (ids: string[]) => void;
  deleteSelected: () => void;
  duplicateSelected: () => string[];
  copySelected: () => void;
  /**
   * Paste the clipboard onto the slide being edited.
   *
   * Copying on one slide and pasting on another **brings the same object into
   * this scene** rather than making a second one: the two slides then hold one
   * token, which is what a `move` between them animates. Anything already in
   * this scene is copied as usual.
   */
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

  // --- slides (plan §3.2) ---
  /** Add an **empty** slide at the end and edit it. */
  addSlide: () => string;
  /**
   * Insert a slide after `index` holding the same objects in the same places,
   * and nothing else — the "and then…" slide. Distinct from
   * {@link duplicateSlide}, which also copies what *happens* on the source
   * slide; this copies only where it leaves everything.
   */
  continueSlide: (index: number) => string | undefined;
  /**
   * Copy the previous slide's cast into slide `index`, where it left them,
   * without touching what is already there. The repair for "I added a slide and
   * now there's nothing to animate" — and it fills the slide in place rather
   * than making another one, so nothing pinned to it (an attack's timing) is
   * lost to a delete-and-recreate.
   */
  carryOverInto: (index: number) => void;
  duplicateSlide: (index: number) => void;
  deleteSlide: (index: number) => void;
  moveSlide: (from: number, to: number) => void;
  selectSlide: (index: number) => void;
  setSlideName: (index: number, name: string) => void;

  // --- animations (plan §3.4) ---
  addAnimation: (slideIndex: number, objectId: string) => string | undefined;
  /**
   * Give every selected object the same animation, in one go (plan §18.9).
   * Returns the new ids, in document order. One action rather than a loop over
   * {@link addAnimation}, so animating a group of six is a single undo.
   */
  animateSelection: (slideIndex: number) => string[];
  updateAnimation: (
    slideIndex: number,
    animId: string,
    patch: Partial<Omit<Anim, "id">>,
  ) => void;
  /**
   * Apply one patch to several animations at once. Editing a row that stands
   * for a whole selection has to be a single action, or a group of six takes
   * six undos to take back one edit.
   */
  updateAnimations: (
    slideIndex: number,
    animIds: string[],
    patch: Partial<Omit<Anim, "id">>,
  ) => void;
  /**
   * Write a drawn route onto an object as a `move` (plan §7).
   *
   * `route` is the journey in **centre** coordinates, excluding where the object
   * already is: the corners it turns, ending where it comes to rest. Fewer than
   * one point is not a journey and does nothing.
   *
   * Creates the animation or replaces the route on `animId`, so the same call
   * backs both "draw a move" and "redraw this one". One action, so one undo —
   * a route drawn in six clicks must not take six presses to take back.
   */
  drawMove: (
    slideIndex: number,
    objectId: string,
    route: readonly Point[],
    animId?: string,
  ) => string | undefined;
  deleteAnimation: (slideIndex: number, animId: string) => void;
  deleteAnimations: (slideIndex: number, animIds: string[]) => void;

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
   * from a slide. *When* it fires is a separate question: it's pinned to the slide
   * being edited, or to the first one when you're laying out the board — and a
   * plan with no slides gets one, because an attack that never fires is furniture.
   *
   * A definition with **placeholders** (§18.14) takes them from the current
   * selection, in document order — select the boss and the tank, then place the
   * frontal. Too small a selection and nothing is placed: a definition with
   * holes in it isn't a thing you can put on a board.
   */
  addAttack: (
    attackId: string,
    at: { x: number; y: number },
    slideId?: string,
  ) => string | undefined;
  /** Retune a placed attack — position, rotation, scale, slide or start offset. */
  updateAttack: (
    instanceId: string,
    patch: Partial<Omit<AttackInstance, "id" | "attackId">>,
  ) => void;
  removeAttack: (instanceId: string) => void;
  /**
   * Move a placed attack through the board's stack — past objects as well as
   * past other attacks, because they share one order. `delta` counts places and
   * is clamped to the ends.
   */
  reorderAttack: (instanceId: string, delta: number) => void;

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

/**
 * The properties that live on the *slide* rather than on the object. Everything
 * else a patch can carry — tint, label, z, the origin — is slide-independent and
 * belongs to the object itself.
 *
 * `satisfies` ties this to {@link SlideState}, so a field added to the document's
 * per-slide state is a compile error here until it is handled.
 */
const SLIDE_KEYS = [
  "x",
  "y",
  "w",
  "h",
  "rotation",
  "opacity",
  "visible",
] as const satisfies readonly (keyof SlideState)[];

/** Split a property patch into the per-slide part and the object-level part. */
function splitPatch(patch: Partial<ObjectBase>): {
  slide: Partial<ObjectState>;
  objectOnly: Partial<ObjectBase>;
} {
  const slide: Record<string, unknown> = {};
  const objectOnly: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((SLIDE_KEYS as readonly string[]).includes(key)) slide[key] = value;
    else objectOnly[key] = value;
  }
  return { slide, objectOnly };
}

/**
 * Write transform-ish properties into the slide being edited. The single choke
 * point that makes "the editor edits the current slide's layout" true (plan §5)
 * — every tool that moves anything goes through here, which is what keeps them
 * all slide-aware without knowing they are.
 *
 * It writes to exactly one slide and never to any other, which is the whole
 * point of the model: this used to fan a sparse override out along a cascade, so
 * editing slide 2 moved the object on every slide after it.
 */
function writeSlideState(
  s: EditorState,
  id: string,
  patch: Partial<ObjectState>,
): void {
  if (Object.keys(patch).length === 0) return;
  const state = s.slides[s.currentSlideIndex]?.states[id];
  if (state) Object.assign(state, patch);
}

/**
 * Put `id` on the slide being edited, and on no other — what "slides are
 * independent" means at the moment a thing is created.
 *
 * A token dropped while writing slide 4 belongs to slide 4. It has not entered
 * the fight yet on slide 1, and it does not automatically stay for slide 5
 * either: carrying it forward is something the author says by duplicating the
 * slide or continuing from it, not something adding an object decides for them.
 *
 * Under {@link EditorState.sharedCast} it lands on every slide instead — see
 * that flag for why the attack designer is the exception.
 */
function putOnCurrentSlide(
  s: EditorState,
  id: string,
  state: ObjectState,
): void {
  const slides = s.sharedCast ? s.slides : [s.slides[s.currentSlideIndex]];
  for (const slide of slides) {
    if (slide) slide.states[id] = { ...state };
  }
}

/** The slides a structural edit reaches: this one, or all of them. */
function editedSlides(s: EditorState): (Slide | undefined)[] {
  return s.sharedCast ? s.slides : [s.slides[s.currentSlideIndex]];
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
  objectIds: readonly string[],
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

/** One item on the board — an object or an attack — and where it is drawn. */
interface StackItem {
  kind: "object" | "attack";
  id: string;
  z: number;
}

/**
 * The board in draw order, objects and attacks together (plan §18.12).
 *
 * They share one stacking scale, which is what lets a token stand on top of a
 * void zone — before this, attacks were simply drawn after every object and so
 * took every click, whatever the order said.
 */
export function boardStack(s: {
  objects: Record<string, PlanObject>;
  objectIds: string[];
  attacks: AttackInstance[];
}): StackItem[] {
  const items: StackItem[] = s.objectIds.flatMap((id) => {
    const object = s.objects[id];
    return object ? [{ kind: "object" as const, id, z: object.base.z }] : [];
  });
  for (const attack of s.attacks) {
    items.push({ kind: "attack", id: attack.id, z: attackZ(attack) });
  }
  return items.sort((a, b) => a.z - b.z);
}

/** Offset (native px) applied to duplicated/pasted copies so they're visible. */
const CLONE_OFFSET = 20;

/**
 * Copy an object under a fresh id, nudged by `CLONE_OFFSET`. Shared by
 * duplicate and paste so both produce identical results.
 *
 * `appearance` is the source's *resolved* state on the current slide, so a copy
 * lands where the original visibly is rather than at its base — the two differ
 * as soon as a slide overrides the original.
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
      slides: [makeFirstSlide()],
      selectedIds: [],
      selectedAttackIds: [],
      view: INITIAL_VIEW,
      stageSize: INITIAL_STAGE_SIZE,
      snapEnabled: false,
      gridSize: DEFAULT_GRID_SIZE,
      clipboard: [],
      currentSlideIndex: 0,
      sharedCast: false,

      setSharedCast: (shared) =>
        set((s) => {
          s.sharedCast = shared;
        }),

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
          putOnCurrentSlide(s, object.id, seedState(object));
          s.selectedIds = [object.id];
          s.selectedAttackIds = [];
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
          putOnCurrentSlide(s, object.id, seedState(object));
          s.selectedIds = [object.id];
          s.selectedAttackIds = [];
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
          putOnCurrentSlide(s, object.id, seedState(object));
          s.selectedIds = [object.id];
          s.selectedAttackIds = [];
        });
        return object.id;
      },

      updateObject: (id, patch) =>
        set((s) => {
          const object = s.objects[id];
          if (!object) return;
          const { slide, objectOnly } = splitPatch(patch);
          // tint/label/z/origin belong to the object; transforms to the slide.
          if (Object.keys(objectOnly).length > 0) {
            Object.assign(object.base, objectOnly);
          }
          writeSlideState(s, id, slide);
        }),

      updateStyle: (id, patch) =>
        set((s) => {
          const object = s.objects[id];
          if (!object) return;
          // Style is slide-independent (like tint) — it lives on the object,
          // never in a slide's states. Merge so toggles compose.
          object.style = { ...object.style, ...patch };
        }),

      moveObject: (id, x, y) =>
        set((s) => {
          const object = s.objects[id];
          if (!object || object.locked) return;
          const grid = s.snapEnabled ? s.gridSize : 0;
          writeSlideState(s, id, {
            x: snapValue(x, grid),
            y: snapValue(y, grid),
          });
        }),

      nudgeSelected: (dx, dy, big = false) =>
        set((s) => {
          const distance = s.snapEnabled ? s.gridSize : big ? 10 : 1;
          for (const id of s.selectedIds) {
            const object = s.objects[id];
            if (!object || object.locked) continue;
            // Nudge from where the object *currently appears* — this slide's
            // position, which is the only one it has.
            const current = resolveObjectState(
              object,
              s.slides,
              s.currentSlideIndex,
            );
            writeSlideState(s, id, {
              x: current.x + dx * distance,
              y: current.y + dy * distance,
            });
          }
        }),

      setLocked: (id, locked) =>
        set((s) => {
          const object = s.objects[id];
          if (object) object.locked = locked;
        }),

      setFollow: (id, follow) =>
        set((s) => {
          const object = s.objects[id];
          if (!object) return;
          // An empty follow is dropped rather than stored: "follows nothing" and
          // "has no opinion" are the same state, and keeping both would let a
          // plan disagree with itself about which it meant.
          if (isFollowing(follow)) object.follow = follow;
          else delete object.follow;
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
          s.selectedIds = s.selectedIds.filter((id) => !doomed.has(id));

          // Delete takes something out of *this scene*, the way it does in
          // PowerPoint — the copy on slide 5 is a different appearance of it and
          // isn't what you pointed at. Its animations here go too: an animation
          // is about an object being on the slide.
          for (const here of editedSlides(s)) {
            if (!here) continue;
            for (const id of doomed) delete here.states[id];
            here.animations = here.animations.filter(
              (a) => !doomed.has(a.objectId),
            );
          }

          // An object no slide shows any more is gone from the plan: keeping the
          // definition would leave an invisible thing in every list that names
          // objects, with no slide to select it from.
          const orphaned = new Set(
            [...doomed].filter((id) =>
              s.slides.every((slide) => slide.states[id] === undefined),
            ),
          );
          if (orphaned.size === 0) return;
          for (const id of orphaned) delete s.objects[id];
          s.objectIds = s.objectIds.filter((id) => !orphaned.has(id));
          for (const slide of s.slides) {
            slide.animations = slide.animations.filter(
              (a) => !orphaned.has(a.objectId),
            );
          }
          // An attack argument can name plan objects (§18.4 `objectRefs`), so a
          // deleted object must drop out of those too or it dangles.
          for (const attack of s.attacks) {
            for (const [key, value] of Object.entries(attack.args)) {
              if (
                Array.isArray(value) &&
                value.some((id) => orphaned.has(id))
              ) {
                attack.args[key] = value.filter((id) => !orphaned.has(id));
              }
            }
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

      paste: () => {
        const { clipboard, objects, slides, currentSlideIndex } = get();
        // Copy on one slide, paste on another: the object *joins this scene*
        // rather than being duplicated into it. Same id, same place — which is
        // what makes it the same token, and the only reason a `move` between
        // the two slides has anything to animate. Anything else (a fresh
        // clipboard, or an object already in this scene) is an ordinary copy.
        const rejoining = clipboard.filter(
          (source) =>
            objects[source.id] &&
            !isOnSlide(slides, currentSlideIndex, source.id),
        );
        const rejoined = rejoining.map((source) => source.id);
        if (rejoining.length > 0) {
          set((s) => {
            for (const source of rejoining) {
              putOnCurrentSlide(s, source.id, {
                ...resolveObjectState(source, s.slides, s.currentSlideIndex),
                visible: true,
              });
            }
            s.selectedIds = objectsOnSlide(
              s.objectIds,
              s.slides,
              s.currentSlideIndex,
            ).filter((id) => rejoined.includes(id));
            s.selectedAttackIds = [];
          });
        }
        const copies = clipboard.filter(
          (source) => !rejoined.includes(source.id),
        );
        return copies.length > 0
          ? [...rejoined, ...get().addClones(copies)]
          : rejoined;
      },

      addClones: (sources) => {
        if (sources.length === 0) return [];
        const { objectIds, slides, currentSlideIndex } = get();
        const startZ = objectIds.length;
        const clones = sources.map((source, i) => {
          const appearance = resolveObjectState(
            source,
            slides,
            currentSlideIndex,
          );
          // A source that isn't in this scene resolves as hidden, precisely
          // because it isn't here — but a copy put here is here.
          const onSlide = isOnSlide(slides, currentSlideIndex, source.id);
          return cloneObject(source, startZ + i, {
            ...appearance,
            visible: onSlide ? appearance.visible : true,
          });
        });
        set((s) => {
          for (const clone of clones) {
            s.objects[clone.id] = clone;
            s.objectIds.push(clone.id);
            putOnCurrentSlide(s, clone.id, seedState(clone));
          }
          s.selectedIds = clones.map((c) => c.id);
          s.selectedAttackIds = [];
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
          // Only what this slide has: a group can span slides, and pulling in a
          // member that isn't in this scene would put handles on nothing.
          const here = objectsOnSlide(
            s.objectIds,
            s.slides,
            s.currentSlideIndex,
          );
          s.selectedIds = withGroupMembers(s.objects, here, ids);
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
          // A group toggles as a unit, never member by member — but only the
          // part of it that is in this scene.
          const here = objectsOnSlide(
            s.objectIds,
            s.slides,
            s.currentSlideIndex,
          );
          const members = withGroupMembers(s.objects, here, [id]);
          const selected = new Set(s.selectedIds);
          s.selectedIds = members.some((m) => selected.has(m))
            ? s.selectedIds.filter((x) => !members.includes(x))
            : [...s.selectedIds, ...members.filter((m) => !selected.has(m))];
        }),
      selectAll: () =>
        set((s) => {
          // Everything *here* — an object on another slide isn't on screen, and
          // "select all" that grabbed it would move things you can't see.
          s.selectedIds = objectsOnSlide(
            s.objectIds,
            s.slides,
            s.currentSlideIndex,
          );
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

      addSlide: () => {
        // An empty stage. A slide is its own scene, so a new one starts as one —
        // carrying the last slide's cast over is a thing to *ask* for, with
        // "continue" or "duplicate", not the price of adding a slide at all.
        const state = get();
        const slide: Slide = {
          id: nextSlideId(),
          name: `Slide ${state.slides.length + 1}`,
          states: {},
          animations: [],
        };
        set((s) => {
          s.slides.push(slide);
          s.currentSlideIndex = s.slides.length - 1;
          // Nothing on the new slide, so nothing on it can be selected.
          s.selectedIds = [];
          s.selectedAttackIds = [];
        });
        return slide.id;
      },

      continueSlide: (index) => {
        // Where the last scene *left off* — settled, not opening: if a token
        // walked across the board on the source slide, "and then…" starts where
        // it arrived, not back at the start of its journey. Read through
        // `get()`, never from the immer draft: drafts are Proxies and
        // `structuredClone` throws on them.
        const source = get().slides[index];
        if (!source) return;
        const slide: Slide = {
          id: nextSlideId(),
          name: `Slide ${index + 2}`,
          states: structuredClone(settledStates(source)),
          animations: [],
        };
        set((s) => {
          s.slides.splice(index + 1, 0, slide);
          s.currentSlideIndex = index + 1;
        });
        return slide.id;
      },

      carryOverInto: (index) =>
        set((s) => {
          const previous = s.slides[index - 1];
          const slide = s.slides[index];
          if (!previous || !slide) return;
          // Settled, for the same reason `continueSlide` uses it: this slide
          // carries on from where the previous one finished.
          for (const [id, state] of Object.entries(
            settledStates({ ...previous, states: { ...previous.states } }),
          )) {
            // Never overwrite: anything already in this scene has been placed
            // here deliberately, and the previous slide's position for it is
            // exactly what the author moved it away from.
            if (!slide.states[id]) slide.states[id] = { ...state };
          }
        }),

      duplicateSlide: (index) => {
        // Read through `get()`, never from the immer draft: drafts are Proxies
        // and `structuredClone` throws on them.
        const source = get().slides[index];
        if (!source) return;
        const copy: Slide = {
          id: nextSlideId(),
          name: `${source.name ?? `Slide ${index + 1}`} copy`,
          states: structuredClone(source.states),
          // Animations are copied, but each needs its own identity.
          animations: source.animations.map((a) => ({
            ...structuredClone(a),
            id: nextAnimId(),
          })),
          ...(source.autoAdvanceMs !== undefined
            ? { autoAdvanceMs: source.autoAdvanceMs }
            : {}),
        };
        // The attacks this slide fires come along too — a duplicated slide that
        // dropped them would only look like a copy.
        const copiedAttacks = get()
          .attacks.filter((a) => a.slideId === source.id)
          .map((a) => ({
            ...structuredClone(a),
            id: nextAttackId(),
            slideId: copy.id,
          }));
        set((s) => {
          s.slides.splice(index + 1, 0, copy);
          s.attacks.push(...copiedAttacks);
          s.currentSlideIndex = index + 1;
        });
      },

      deleteSlide: (index) =>
        set((s) => {
          const doomed = s.slides[index];
          // The last slide can't go: a plan is its slides, and one with none has
          // no layout to draw and nowhere to put the cursor.
          if (!doomed || s.slides.length <= 1) return;
          s.slides.splice(index, 1);
          // An attack fires on exactly one slide; without it there is no moment
          // for it to happen, so it goes too (undo brings both back).
          s.attacks = s.attacks.filter((a) => a.slideId !== doomed.id);
          s.currentSlideIndex = Math.min(
            s.currentSlideIndex,
            s.slides.length - 1,
          );
          s.selectedIds = objectsOnSlide(
            s.selectedIds,
            s.slides,
            s.currentSlideIndex,
          );
        }),

      moveSlide: (from, to) =>
        set((s) => {
          if (!s.slides[from] || to < 0 || to >= s.slides.length) return;
          const [moved] = s.slides.splice(from, 1);
          if (!moved) return;
          s.slides.splice(to, 0, moved);
          s.currentSlideIndex = to;
        }),

      selectSlide: (index) =>
        set((s) => {
          s.currentSlideIndex = Math.max(
            0,
            Math.min(index, s.slides.length - 1),
          );
          // Drop anything the new slide doesn't have. The handles would
          // otherwise sit on an object that isn't in this scene, and the next
          // drag would edit a slide the user is no longer looking at.
          s.selectedIds = objectsOnSlide(
            s.selectedIds,
            s.slides,
            s.currentSlideIndex,
          );
        }),

      setSlideName: (index, name) =>
        set((s) => {
          const slide = s.slides[index];
          if (slide) slide.name = name;
        }),

      addAnimation: (slideIndex, objectId) => {
        const { slides, objects } = get();
        // An animation says what an object does *while this slide plays*, so it
        // needs the object to be in the scene at all.
        if (!objects[objectId] || !isOnSlide(slides, slideIndex, objectId)) {
          return undefined;
        }
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
          s.slides[slideIndex]?.animations.push(anim);
        });
        return anim.id;
      },

      animateSelection: (slideIndex) => {
        const { slides, objects, objectIds, selectedIds } = get();
        if (!slides[slideIndex]) return [];
        // Document order, so the animation list reads like the board's z-order
        // rather than the order things happened to be clicked in.
        const targets = objectsOnSlide(objectIds, slides, slideIndex).filter(
          (id) => selectedIds.includes(id) && objects[id],
        );
        if (targets.length === 0) return [];

        const anims: Anim[] = targets.map((objectId) => ({
          id: nextAnimId(),
          objectId,
          kind: "motion",
          effect: "move",
          trigger: "onEnter",
          delayMs: 0,
          durationMs: 500,
          easing: "power2.out",
        }));
        set((s) => {
          s.slides[slideIndex]?.animations.push(...anims);
        });
        return anims.map((a) => a.id);
      },

      updateAnimation: (slideIndex, animId, patch) =>
        get().updateAnimations(slideIndex, [animId], patch),

      updateAnimations: (slideIndex, animIds, patch) =>
        set((s) => {
          const wanted = new Set(animIds);
          for (const anim of s.slides[slideIndex]?.animations ?? []) {
            if (wanted.has(anim.id)) Object.assign(anim, patch);
          }
        }),

      drawMove: (slideIndex, objectId, route, animId) => {
        const { slides, objects } = get();
        const object = objects[objectId];
        if (!object || route.length === 0) return undefined;
        if (!isOnSlide(slides, slideIndex, objectId)) return undefined;

        // The route is drawn in centres, because that is what a drawn line
        // means; the document stores an object's top-left. Converted with the
        // size the object has *here*, matching how the player walks the path.
        const state = resolveObjectState(object, slides, slideIndex);
        const half = { x: state.w / 2, y: state.h / 2 };
        const last = route[route.length - 1]!;
        const params = {
          path: route.slice(0, -1).map((p) => ({ x: p.x, y: p.y })),
          toX: last.x - half.x,
          toY: last.y - half.y,
        };

        const existing = animId
          ? slides[slideIndex]?.animations.find((a) => a.id === animId)
          : undefined;
        if (existing) {
          get().updateAnimation(slideIndex, existing.id, {
            params: { ...existing.params, ...params },
          });
          return existing.id;
        }

        const anim: Anim = {
          id: nextAnimId(),
          objectId,
          kind: "motion",
          effect: "move",
          trigger: "onEnter",
          delayMs: 0,
          // Long enough to read as a journey rather than a jump. The panel and
          // the timeline are where it gets tuned.
          durationMs: 1000,
          easing: "power2.out",
          params,
        };
        set((s) => {
          s.slides[slideIndex]?.animations.push(anim);
        });
        return anim.id;
      },

      deleteAnimation: (slideIndex, animId) =>
        get().deleteAnimations(slideIndex, [animId]),

      deleteAnimations: (slideIndex, animIds) =>
        set((s) => {
          const slide = s.slides[slideIndex];
          if (!slide) return;
          const doomed = new Set(animIds);
          slide.animations = slide.animations.filter((a) => !doomed.has(a.id));
        }),

      setAttackDefs: (defs) =>
        set((s) => {
          s.attackDefs = defs;
        }),

      addAttack: (attackId, at, slideId) => {
        const state = get();
        const def = state.attackDefs[attackId];

        // Fill the definition's holes from the selection, in document order.
        const slots: Record<string, string> = {};
        const holes = def ? attackSlots(def) : [];
        if (holes.length > 0) {
          const chosen = state.objectIds.filter((id) =>
            state.selectedIds.includes(id),
          );
          if (chosen.length < holes.length) return undefined;
          holes.forEach((hole, index) => {
            slots[hole.id] = chosen[index]!;
          });
        }
        // An attack fires on the slide you're editing — there is always one, so
        // there is nothing to create and no "laid out but never happens" case.
        const firesOn =
          slideId ??
          state.slides[state.currentSlideIndex]?.id ??
          state.slides[0]!.id;
        // The def's default size is the size it was drawn at; centre it on the
        // drop point so the attack lands where you aimed (plan §18.2).
        const size = def?.defaultSize ?? { w: 400, h: 400 };
        const instance: AttackInstance = {
          id: nextAttackId(),
          attackId,
          slideId: firesOn,
          // On top of what's there, like every other newly added thing.
          z: boardStack(state).length,
          x: at.x - size.w / 2,
          y: at.y - size.h / 2,
          w: size.w,
          h: size.h,
          rotation: 0,
          startMs: 0,
          slots,
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

      reorderAttack: (instanceId, delta) =>
        set((s) => {
          const instance = s.attacks.find((a) => a.id === instanceId);
          if (!instance) return;

          // Everything on the board, in the order it is drawn. Objects hold
          // integers 0..n-1 and renumber themselves as they come and go, so the
          // attack takes a value *between* two of them and stays put.
          const stack = boardStack(s).filter((item) => item.id !== instanceId);
          const from = boardStack(s).findIndex(
            (item) => item.id === instanceId,
          );
          const to = Math.max(0, Math.min(stack.length, from + delta));

          const below = stack[to - 1]?.z;
          const above = stack[to]?.z;
          instance.z =
            below === undefined
              ? (above ?? 0) - 1
              : above === undefined
                ? below + 1
                : (below + above) / 2;
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
          s.slides = doc.slides;
          s.selectedIds = [];
          s.selectedAttackIds = [];
          s.currentSlideIndex = 0;
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
          s.slides = [makeFirstSlide()];
          s.view = INITIAL_VIEW;
          s.clipboard = [];
          s.currentSlideIndex = 0;
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
      // Which slices those are is defined once, beside the serializer.
      partialize: pickPlanDoc,
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
