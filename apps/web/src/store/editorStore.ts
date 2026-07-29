import { create } from "zustand";
import { temporal } from "zundo";
import { shallow } from "zustand/shallow";
import { immer } from "zustand/middleware/immer";
import {
  attackAnchor,
  attackSlots,
  centrePoint,
  isDeferredTrigger,
  isFollowing,
  isOnSlide,
  makeFirstSlide,
  objectsOnSlide,
  placementTransform,
  settledStates,
  resolveObjectState,
  seedState,
  stampAttack,
  stateBeforeAnim,
  topLeftForCentre,
  type Anim,
  type AttackInstance,
  type AttackParamValue,
  type AttackTransform,
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
import {
  nextAnimId,
  nextAttackId,
  nextGroupId,
  nextObjectId,
  nextSlideId,
} from "./ids";
import {
  fitView,
  screenToNative,
  zoomAt,
  MIN_OBJECT_SIZE,
  type Box,
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
  pruneAttacks,
  pruneGroups,
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
  /**
   * Move several objects at once. **One action, so one undo** — dragging a
   * group of three is a single thing the author did, and taking it back should
   * not mean pressing undo three times and watching the group come apart on the
   * way. Locked objects are skipped, exactly as in {@link moveObject}.
   */
  moveObjects: (moves: readonly { id: string; x: number; y: number }[]) => void;
  nudgeSelected: (dx: number, dy: number, big?: boolean) => void;
  setLocked: (id: string, locked: boolean) => void;
  /**
   * Settle a finished transform gesture — **the whole of it, in one action**,
   * so turning a group of three is one undo rather than three that take it
   * apart on the way back.
   *
   * Given the boxes the objects have ended up in, whoever the handles reached
   * and whoever they didn't: a hidden member keeps its node so playback can
   * reveal it but never gets handles, and a group whose hidden member stayed
   * behind while the rest turned would be deformed the moment the slide
   * revealed it (see `SelectionTransformer`, which works out where it goes).
   * Locked objects are skipped, because "don't move this" is a thing the author
   * said on purpose.
   */
  applyTransforms: (boxes: readonly ({ id: string } & Box)[]) => void;
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
  /**
   * Select exactly these objects, **without** pulling their groups in — the one
   * way to get at a single member of a group (plan §18.1).
   *
   * Grouping is a claim about what a click means, not a weld: a group of six
   * still has six things in it, and nudging one of them two pixels left should
   * not mean taking the group apart and putting it back together. Alt-clicking
   * on the canvas and picking a member's row in the Objects panel both land
   * here; everything else goes through {@link select} and gets the whole group.
   */
  selectOnly: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  /**
   * Tie the current selection together so it selects and transforms as one
   * (plan §18.1). Returns the new group id, or undefined for a selection of
   * fewer than two. Members already in other groups are merged into this one.
   */
  groupSelected: () => string | undefined;
  /** Dissolve the groups any selected object belongs to. */
  ungroupSelected: () => void;
  /** Dissolve one group by id, from the Objects panel. */
  ungroup: (groupId: string) => void;
  /** Select every member of a group that is in this scene. */
  selectGroup: (groupId: string) => void;
  /** Name a group. Blank clears it, and the panel falls back to "Group". */
  renameGroup: (groupId: string, name: string) => void;
  /**
   * Lock or unlock a whole group in one action (plan §18.1).
   *
   * Fanned out onto the members rather than stored on the group, so the canvas,
   * the transformer and every hotkey keep answering the one question they
   * already ask — `object.locked` — and there is no second opinion for them to
   * disagree with. It also means unlocking a group and then locking one member
   * is a thing you can say.
   */
  setGroupLocked: (groupId: string, locked: boolean) => void;
  /**
   * Show or hide a whole group **on the slide being edited**, for the same
   * reason and in the same way. Visibility is per-slide (it is part of a
   * slide's state), so this is one slide's answer, not the group's.
   */
  setGroupVisible: (groupId: string, visible: boolean) => void;

  // --- attacks (plan §21) ---
  /**
   * Place an attack on the slide being edited, resolved on the spot into
   * ordinary objects, states and animations.
   *
   * Returns the instance id, or `undefined` when it can't be placed — an
   * unknown definition, or a definition with slots and the wrong number of
   * objects selected to fill them. The caller says why (a toast); this only
   * says no, because "which objects" is a question about the selection and the
   * store is where the selection lives.
   *
   * Slots bind in authoring order to the selection, and the attack lands on the
   * first one. With no slots it lands on `at`.
   */
  placeAttack: (defId: string, at: Point) => string | undefined;
  /**
   * Move, turn and scale a whole placement.
   *
   * The recipe changes and everything is re-derived from the definition — which
   * is why this and not `applyTransforms`: a plain group transform would move
   * the objects and leave their motion paths behind.
   */
  setAttackTransform: (instanceId: string, transform: AttackTransform) => void;
  /** When the placement starts on its slide, and how far its timings stretch. */
  setAttackTiming: (
    instanceId: string,
    patch: { anchorDelayMs?: number; timeScale?: number },
  ) => void;
  /** Give a parameter of this placement a value of its own. */
  setAttackParam: (
    instanceId: string,
    name: string,
    value: AttackParamValue,
  ) => void;
  /** Bind one of the definition's slots to a different object on the slide. */
  setAttackSlot: (
    instanceId: string,
    slotObjectId: string,
    planObjectId: string,
  ) => void;
  /**
   * Let the placement go: its objects stay exactly where they are, as ordinary
   * grouped objects, and stop being an attack.
   *
   * The escape hatch, and it is deliberately one-way. While a placement is
   * attached its members are derived and a re-stamp would overwrite anything
   * done to one of them individually; detaching is how an author says "from
   * here it's mine".
   */
  detachAttack: (instanceId: string) => void;
  /** Remove a placement and everything it owns. Objects bound to its slots stay. */
  deleteAttack: (instanceId: string) => void;

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
   * than making another one, so nothing pinned to it is lost to a
   * delete-and-recreate.
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
   * **One animation per leg.** Three clicks make three chained `move`s, not one
   * move with two waypoints, so every leg has its own bar in the timeline with
   * its own delay and duration — which is what lets a planner say "run in, wait
   * two seconds, run out" without splitting the slide up. Each leg starts where
   * the one before it ended (see `stateBeforeAnim`), so the chain draws and
   * plays as the single line that was drawn.
   *
   * Creates those animations or, given `animId`, redraws that leg — replacing it
   * in place and inserting any further legs directly after it, so its timing,
   * easing and position in the slide's order survive. One action, so one undo —
   * a route drawn in six clicks must not take six presses to take back.
   *
   * Returns the id of the first leg.
   */
  drawMove: (
    slideIndex: number,
    objectId: string,
    route: readonly Point[],
    animId?: string,
  ) => string | undefined;
  deleteAnimation: (slideIndex: number, animId: string) => void;
  deleteAnimations: (slideIndex: number, animIds: string[]) => void;

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
  const slide = s.slides[s.currentSlideIndex];
  const state = slide?.states[id];
  if (!slide || !state) return;
  const before = { ...state };
  Object.assign(state, patch);
  reanchorRoutes(slide, id, before, state);
}

/** How far the box's middle sits from its stored top-left. */
const centreOffset = (t: ObjectState): Point =>
  centrePoint({ ...t, x: 0, y: 0 });

/**
 * Keep a drawn route where it was drawn when the object it belongs to is turned
 * or resized.
 *
 * A move stores its destination as the object's **top-left**, but a route is a
 * line between **centres** — and a box turns about its top-left, so the centre a
 * given top-left implies swings with rotation and slides with size. Left to
 * itself, turning a token a quarter turn drags every destination after it clear
 * across the board, though nothing about the journey it describes has changed.
 *
 * So the stored top-left is re-derived to leave the destination's *centre*
 * exactly where the author put it. Interior waypoints are already centres and
 * need none of this — repairing that asymmetry is the whole job here.
 *
 * Only this slide's animations: a route belongs to the slide it was drawn on,
 * and so does the rotation being written.
 */
function reanchorRoutes(
  slide: Slide,
  id: string,
  before: ObjectState,
  after: ObjectState,
): void {
  const was = centreOffset(before);
  const now = centreOffset(after);
  const dx = was.x - now.x;
  const dy = was.y - now.y;
  // A plain move or nudge changes neither, which is the overwhelmingly common
  // call and must stay a no-op rather than a rewrite of every animation.
  if (dx === 0 && dy === 0) return;
  for (const anim of slide.animations) {
    if (anim.objectId !== id || anim.effect !== "move" || !anim.params)
      continue;
    // Each end independently: a move with no destination has not been drawn
    // yet, and there is nothing to hold still.
    if (anim.params.toX !== undefined) anim.params.toX += dx;
    if (anim.params.toY !== undefined) anim.params.toY += dy;
  }
}

/**
 * Put `id` on the slide being edited, and on no other — what "slides are
 * independent" means at the moment a thing is created.
 *
 * A token dropped while writing slide 4 belongs to slide 4. It has not entered
 * the fight yet on slide 1, and it does not automatically stay for slide 5
 * either: carrying it forward is something the author says by duplicating the
 * slide or continuing from it, not something adding an object decides for them.
 */
function putOnCurrentSlide(
  s: EditorState,
  id: string,
  state: ObjectState,
): void {
  const slide = s.slides[s.currentSlideIndex];
  if (slide) slide.states[id] = { ...state };
}

/** The slides a structural edit reaches — the one being edited. */
function editedSlides(s: EditorState): (Slide | undefined)[] {
  return [s.slides[s.currentSlideIndex]];
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

/**
 * Pull a group's members together in the z-order, at their front-most member
 * (plan §18.1: "members stay contiguous in z-order").
 *
 * Grouping says these things are one thing, and one thing cannot have another
 * object sandwiched inside it — a stranger drawn between two members would sit
 * in front of half a group and behind the other half. Gathering at the
 * front-most member means the group ends up where its most forward part already
 * was, so nothing that was in front of the group falls behind it.
 */
function gatherMembers(
  s: { objects: Record<string, PlanObject>; objectIds: string[] },
  groupId: string,
): void {
  const isMember = (id: string) => s.objects[id]?.groupId === groupId;
  const members = s.objectIds.filter(isMember);
  if (members.length < 2) return;
  const frontIndex = s.objectIds.indexOf(members[members.length - 1]!);
  // Where the run lands once the members are lifted out: after every non-member
  // that was already behind the front-most one.
  const below = s.objectIds.slice(0, frontIndex).filter((id) => !isMember(id));
  const rest = s.objectIds.filter((id) => !isMember(id));
  s.objectIds = [
    ...rest.slice(0, below.length),
    ...members,
    ...rest.slice(below.length),
  ];
}

/**
 * Re-derive one placement from its recipe and its definition (plan §21).
 *
 * **The single choke point for everything an attack instance can do.** Move it,
 * turn it, scale it, retime it, change a parameter, rebind a slot: each writes
 * the recipe and comes back here, and here always starts from the definition.
 * Nothing is ever computed from what was stamped last time, which is what makes
 * coordinate drift impossible rather than merely unlikely (§20).
 *
 * The stamped objects keep their ids, so this updates them in place: their
 * z-order is the author's, and a tether they drew into the attack still finds
 * them. Animations are replaced as one contiguous block at the position the old
 * block held, because the slide's chain runs in document order and a block split
 * apart would chain onto a stranger.
 */
function restampAttack(s: EditorState, instanceId: string): boolean {
  const slideIndex = s.slides.findIndex((slide) =>
    Boolean(slide.attackInstances?.[instanceId]),
  );
  const slide = s.slides[slideIndex];
  const instance = slide?.attackInstances?.[instanceId];
  if (!slide || !instance) return false;

  const def = s.attacks.find((a) => a.id === instance.defId);
  // A definition the plan no longer has leaves its objects exactly where they
  // are: there is nothing to re-derive them from, and deleting a planner's work
  // because a library entry went missing would be the wrong answer by far.
  if (!def) return false;

  const boundStates: Record<string, SlideState> = {};
  for (const planId of Object.values(instance.slots)) {
    const state = slide.states[planId];
    if (state) boundStates[planId] = state;
  }

  const owned = s.objectIds.filter(
    (id) => s.objects[id]?.attackId === instanceId,
  );
  const stamped = stampAttack({
    def,
    instance,
    boundStates,
    // Its group is whatever its objects are already in, so re-stamping never
    // reshuffles the z-order or breaks a group the author renamed.
    groupId:
      owned.map((id) => s.objects[id]?.groupId).find(Boolean) ?? nextGroupId(),
    nextObjectId,
    nextAnimId,
  });

  const kept = new Set(stamped.objects.map((o) => o.id));
  for (const object of stamped.objects) {
    if (!s.objects[object.id]) s.objectIds.push(object.id);
    s.objects[object.id] = object;
  }
  // A definition that lost a member leaves one behind here; take it out of the
  // scene the way deleting it would.
  for (const id of owned) {
    if (kept.has(id)) continue;
    delete s.objects[id];
    delete slide.states[id];
    s.objectIds = s.objectIds.filter((other) => other !== id);
  }
  for (const [id, state] of Object.entries(stamped.states)) {
    slide.states[id] = state;
  }

  const previous = new Set(Object.values(instance.animMap));
  const firstIndex = slide.animations.findIndex((a) => previous.has(a.id));
  const rest = slide.animations.filter((a) => !previous.has(a.id));
  const at = firstIndex === -1 ? rest.length : firstIndex;
  slide.animations = [
    ...rest.slice(0, at),
    ...stamped.animations,
    ...rest.slice(at),
  ];

  slide.attackInstances = {
    ...slide.attackInstances,
    [instanceId]: stamped.instance,
  };
  reindexZ(s);
  return true;
}

/** Read a placement's recipe from whichever slide it lives on. */
function findInstance(
  s: EditorState,
  instanceId: string,
): AttackInstance | undefined {
  for (const slide of s.slides) {
    const instance = slide.attackInstances?.[instanceId];
    if (instance) return instance;
  }
  return undefined;
}

/** One item on the board, and where it is drawn. */
interface StackItem {
  id: string;
  z: number;
}

/** The board in draw order (plan §18.12). */
export function boardStack(s: {
  objects: Record<string, PlanObject>;
  objectIds: string[];
}): StackItem[] {
  const items: StackItem[] = s.objectIds.flatMap((id) => {
    const object = s.objects[id];
    return object ? [{ id, z: object.base.z }] : [];
  });
  return items.sort((a, b) => a.z - b.z);
}

/** Offset (native px) applied to duplicated/pasted copies so they're visible. */
const CLONE_OFFSET = 20;

/**
 * The slowest an attack can be stretched to. Not zero: a `timeScale` of nothing
 * is an attack that takes no time, which the timeline could not draw and the
 * planner could not get hold of again to undo.
 */
const MIN_TIME_SCALE = 0.05;

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

/**
 * How long a whole drawn route takes by default. Long enough to read as a
 * journey rather than a jump; the panel and the timeline are where it gets
 * tuned, per leg.
 */
const DRAWN_MOVE_MS = 1000;
/** No leg is shorter than this, however brief a corner-to-corner hop is. */
const MIN_LEG_MS = 60;

/**
 * Cut a drawn route into one leg per corner, sharing `totalMs` between them
 * **by length**.
 *
 * Splitting by length rather than evenly is what makes a segmented route play
 * like the single line it was drawn as: the object holds one speed across the
 * whole journey instead of dawdling over a short leg and bolting down a long
 * one. Each leg is then free to be retimed on its own — which is the point of
 * segmenting at all.
 */
function splitLegs(
  from: Point,
  corners: readonly Point[],
  totalMs: number,
): { to: Point; durationMs: number }[] {
  const points = [from, ...corners];
  const lengths = corners.map((to, i) =>
    Math.hypot(to.x - points[i]!.x, to.y - points[i]!.y),
  );
  const total = lengths.reduce((sum, l) => sum + l, 0);
  return corners.map((to, i) => ({
    to,
    // A zero-length route (every corner dropped on the object) has no lengths
    // to share by, so it splits evenly rather than dividing by zero.
    durationMs: Math.max(
      MIN_LEG_MS,
      Math.round(
        total > 0
          ? (totalMs * lengths[i]!) / total
          : totalMs / Math.max(corners.length, 1),
      ),
    ),
  }));
}

export const useEditorStore = create<EditorState>()(
  temporal(
    immer((set, get) => ({
      id: "local",
      title: "Untitled plan",
      raid: "",
      encounterId: undefined,
      background: DEFAULT_BACKGROUND,
      objects: {},
      objectIds: [],
      groups: {},
      attacks: [],
      slides: [makeFirstSlide()],
      selectedIds: [],
      view: INITIAL_VIEW,
      stageSize: INITIAL_STAGE_SIZE,
      snapEnabled: false,
      gridSize: DEFAULT_GRID_SIZE,
      clipboard: [],
      currentSlideIndex: 0,

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

      moveObject: (id, x, y) => get().moveObjects([{ id, x, y }]),

      moveObjects: (moves) =>
        set((s) => {
          const grid = s.snapEnabled ? s.gridSize : 0;
          for (const { id, x, y } of moves) {
            const object = s.objects[id];
            if (!object || object.locked) continue;
            writeSlideState(s, id, {
              x: snapValue(x, grid),
              y: snapValue(y, grid),
            });
          }
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

      applyTransforms: (boxes) =>
        set((s) => {
          for (const { id, ...box } of boxes) {
            const object = s.objects[id];
            // A tether has no transform of its own — it is drawn from its
            // endpoints, which are being transformed themselves.
            if (!object || object.locked || object.type === "tether") continue;
            writeSlideState(s, id, {
              x: box.x,
              y: box.y,
              // The same floor the handles enforce, so a member carried by a
              // resize cannot be squashed to nothing.
              w: Math.max(MIN_OBJECT_SIZE, box.w),
              h: Math.max(MIN_OBJECT_SIZE, box.h),
              rotation: box.rotation,
            });
          }
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
          // Deleting members can wear a group down to one, which is not a group,
          // and can take the last object a placement owned (plan §21).
          pruneGroups(s);
          pruneAttacks(s);
          reindexZ(s);
        }),

      deleteSelected: () => {
        const { selectedIds } = get();
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
        }),

      selectOnly: (ids) =>
        set((s) => {
          const here = new Set(
            objectsOnSlide(s.objectIds, s.slides, s.currentSlideIndex),
          );
          s.selectedIds = s.objectIds.filter(
            (id) => here.has(id) && ids.includes(id),
          );
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
        }),
      clearSelection: () =>
        set((s) => {
          s.selectedIds = [];
        }),

      groupSelected: () => {
        if (get().selectedIds.length < 2) return undefined;
        const groupId = nextGroupId();
        set((s) => {
          for (const id of s.selectedIds) {
            const object = s.objects[id];
            if (object) object.groupId = groupId;
          }
          gatherMembers(s, groupId);
          // Taking members out of an older group can leave it with one, which
          // is no longer a group at all.
          pruneGroups(s);
          reindexZ(s);
        });
        return groupId;
      },

      ungroupSelected: () => {
        const state = get();
        const groups = new Set<string>();
        for (const id of state.selectedIds) {
          const groupId = state.objects[id]?.groupId;
          if (groupId) groups.add(groupId);
        }
        for (const groupId of groups) get().ungroup(groupId);
      },

      ungroup: (groupId) =>
        set((s) => {
          for (const id of s.objectIds) {
            const object = s.objects[id];
            if (object?.groupId === groupId) delete object.groupId;
          }
          // The name goes with the group. Keeping it would leave a label with
          // nothing to label, ready to attach itself to a later group that
          // happened to be handed the same id.
          delete s.groups[groupId];
        }),

      selectGroup: (groupId) =>
        set((s) => {
          // Only the part of the group in this scene, exactly as `select` does:
          // a group can span slides, and a member that isn't here has nothing
          // on screen to put handles on.
          s.selectedIds = objectsOnSlide(
            s.objectIds,
            s.slides,
            s.currentSlideIndex,
          ).filter((id) => s.objects[id]?.groupId === groupId);
        }),

      renameGroup: (groupId, name) =>
        set((s) => {
          const trimmed = name.trim();
          // Blank is "no name of its own", not an empty name — the panel then
          // falls back to "Group", which is what clearing the box asks for.
          if (trimmed) s.groups[groupId] = trimmed;
          else delete s.groups[groupId];
        }),

      setGroupLocked: (groupId, locked) =>
        set((s) => {
          for (const id of s.objectIds) {
            const object = s.objects[id];
            if (object?.groupId === groupId) object.locked = locked;
          }
        }),

      setGroupVisible: (groupId, visible) =>
        set((s) => {
          for (const id of s.objectIds) {
            if (s.objects[id]?.groupId !== groupId) continue;
            // Through the same choke point every other transform write uses, so
            // it lands on the slide being edited and on no other.
            writeSlideState(s, id, { visible });
          }
        }),

      // --- attacks (plan §21) ---
      placeAttack: (defId, at) => {
        const state = get();
        const def = state.attacks.find((a) => a.id === defId);
        const slide = state.slides[state.currentSlideIndex];
        if (!def || !slide) return undefined;

        const slots = attackSlots(def.objects);
        // The rule, and the whole of it: an attack that stands for something in
        // the plan can only be placed once the plan has said what.
        const chosen = state.selectedIds.filter((id) => slide.states[id]);
        if (chosen.length !== slots.length) return undefined;

        const anchor = attackAnchor(def.slide.states);
        const firstSlot = slots[0];
        const slotState = firstSlot
          ? def.slide.states[firstSlot.id]
          : undefined;
        const boundState = chosen[0] ? slide.states[chosen[0]] : undefined;
        const transform = placementTransform({
          anchor,
          // With a slot, the attack lands *on* what it was given rather than
          // where the cursor happened to be — which is the point of having one.
          align: slotState ? centrePoint(slotState) : anchor,
          at: boundState ? centrePoint(boundState) : at,
        });

        const instanceId = nextAttackId();
        set((s) => {
          const draft = s.slides[s.currentSlideIndex];
          if (!draft) return;
          draft.attackInstances = {
            ...draft.attackInstances,
            [instanceId]: {
              id: instanceId,
              defId: def.id,
              // Snapshotted, so a placement still reads sensibly if the
              // definition is later renamed or dropped from the library.
              name: def.name,
              transform,
              timeScale: 1,
              anchorDelayMs: 0,
              values: {},
              slots: Object.fromEntries(
                slots.map((slot, i) => [slot.id, chosen[i]!]),
              ),
              objectMap: {},
              animMap: {},
            },
          };
          if (!restampAttack(s, instanceId)) {
            delete draft.attackInstances[instanceId];
            return;
          }
          s.selectedIds = s.objectIds.filter(
            (id) => s.objects[id]?.attackId === instanceId,
          );
        });
        return findInstance(get(), instanceId) ? instanceId : undefined;
      },

      setAttackTransform: (instanceId, transform) =>
        set((s) => {
          const instance = findInstance(s, instanceId);
          if (!instance) return;
          instance.transform = transform;
          restampAttack(s, instanceId);
        }),

      setAttackTiming: (instanceId, patch) =>
        set((s) => {
          const instance = findInstance(s, instanceId);
          if (!instance) return;
          if (patch.anchorDelayMs !== undefined)
            instance.anchorDelayMs = Math.max(0, patch.anchorDelayMs);
          if (patch.timeScale !== undefined)
            instance.timeScale = Math.max(MIN_TIME_SCALE, patch.timeScale);
          restampAttack(s, instanceId);
        }),

      setAttackParam: (instanceId, name, value) =>
        set((s) => {
          const instance = findInstance(s, instanceId);
          if (!instance) return;
          instance.values = { ...instance.values, [name]: value };
          restampAttack(s, instanceId);
        }),

      setAttackSlot: (instanceId, slotObjectId, planObjectId) =>
        set((s) => {
          const instance = findInstance(s, instanceId);
          if (!instance || !s.objects[planObjectId]) return;
          instance.slots = { ...instance.slots, [slotObjectId]: planObjectId };
          restampAttack(s, instanceId);
        }),

      detachAttack: (instanceId) =>
        set((s) => {
          for (const id of s.objectIds) {
            const object = s.objects[id];
            if (object?.attackId === instanceId) delete object.attackId;
          }
          // The group stays: these objects really are one thing, and that was
          // true before the attack let go of them.
          pruneAttacks(s);
        }),

      deleteAttack: (instanceId) => {
        const state = get();
        const owned = state.objectIds.filter(
          (id) => state.objects[id]?.attackId === instanceId,
        );
        // Through the ordinary delete, so a tether hanging off one of these goes
        // with it and nothing has to remember a second set of rules.
        if (owned.length > 0) get().deleteObjects(owned);
        set((s) => {
          pruneAttacks(s);
        });
      },

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
        set((s) => {
          s.slides.splice(index + 1, 0, copy);
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
        const slide = slides[slideIndex];
        if (!object || !slide || route.length === 0) return undefined;
        if (!isOnSlide(slides, slideIndex, objectId)) return undefined;

        const existing = animId
          ? slide.animations.find((a) => a.id === animId)
          : undefined;

        // Where the journey begins: the object's opening state on this slide
        // with everything that plays before this move folded in — the same
        // answer the route overlay draws from and the player walks from. A
        // brand-new move is appended, so for it that is "after everything".
        const start = stateBeforeAnim(
          resolveObjectState(object, slides, slideIndex),
          slide.animations,
          objectId,
          existing?.id,
        );
        // The route is drawn in centres, because that is what a drawn line
        // means; the document stores an object's top-left. Converted through
        // the box the object has *here* — rotation included, since a turned
        // box's middle is not `x + w/2` — matching how the player places it.
        const toTopLeft = (at: Point) => topLeftForCentre(start, at);
        const corners = route.map((p) => ({ x: p.x, y: p.y }));
        const last = corners[corners.length - 1]!;

        // A **deferred** move can't be a chain: a click or a collision fires one
        // animation, and legs after it would have nothing to hang off. Redrawing
        // one keeps the single-animation shape it needs, with the corners as its
        // own waypoints — which is what `params.path` has always been for.
        if (existing && isDeferredTrigger(existing.trigger)) {
          get().updateAnimation(slideIndex, existing.id, {
            params: {
              ...existing.params,
              path: corners.slice(0, -1),
              toX: toTopLeft(last).x,
              toY: toTopLeft(last).y,
            },
          });
          return existing.id;
        }

        const legs = splitLegs(
          centrePoint(start),
          corners,
          existing?.durationMs ?? DRAWN_MOVE_MS,
        );

        // The first leg inherits the redrawn animation's identity — and so its
        // timing, easing and place in the slide's order. A new draw chains onto
        // whatever this object already does on the slide rather than starting
        // at t=0 on top of it, which is the whole point of drawing a second
        // move: it happens *next*.
        const chained = slide.animations.some(
          (a) => a.objectId === objectId && !isDeferredTrigger(a.trigger),
        );
        const template: Pick<
          Anim,
          "objectId" | "kind" | "trigger" | "delayMs" | "easing" | "collideWith"
        > = existing ?? {
          objectId,
          kind: "motion",
          trigger: chained ? "afterPrevious" : "onEnter",
          delayMs: 0,
          easing: "power2.out",
        };

        const anims: Anim[] = legs.map((leg, index) => {
          const first = index === 0;
          return {
            ...template,
            id: first && existing ? existing.id : nextAnimId(),
            effect: "move",
            // Legs after the first run one after the other, back to back: a
            // pause between them is theirs to be given in the timeline, not
            // something a drawn line implies.
            trigger: first ? template.trigger : "afterPrevious",
            delayMs: first ? template.delayMs : 0,
            durationMs: leg.durationMs,
            params: {
              // A leg is a straight hop, so it carries no waypoints of its own
              // — the corners *are* the joins between legs now. Bending one is
              // still possible per leg (double-click its route on the board).
              toX: toTopLeft(leg.to).x,
              toY: toTopLeft(leg.to).y,
            },
          };
        });

        set((s) => {
          const target = s.slides[slideIndex];
          if (!target) return;
          if (existing) {
            const at = target.animations.findIndex((a) => a.id === existing.id);
            if (at < 0) return;
            target.animations.splice(at, 1, ...anims);
          } else {
            target.animations.push(...anims);
          }
        });
        return anims[0]?.id;
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
          // Every document slice at once, rather than a hand-written list of
          // fields: `fromPlan` returns exactly a `PlanDoc`, so a field added to
          // the document is loaded here the day it exists. The hand-written
          // version had already silently stopped loading one.
          Object.assign(s, fromPlan(plan));
          s.selectedIds = [];
          s.currentSlideIndex = 0;
        }),

      getPlan: () => toPlan(get()),

      reset: () =>
        set((s) => {
          s.objects = {};
          s.objectIds = [];
          s.groups = {};
          s.attacks = [];
          s.selectedIds = [];
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
export function viewCentreNative(state: {
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
