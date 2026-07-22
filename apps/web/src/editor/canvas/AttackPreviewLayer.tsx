import { useMemo, useRef } from "react";
import { Group, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Group as GroupNode } from "konva/lib/Group";
import {
  expandPlan,
  resolveObjectState,
  SCHEMA_VERSION,
  type AttackDef,
  type AttackInstance,
  type Background,
  type Plan,
  type PlanObject,
} from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { ObjectVisual } from "./ObjectVisual";

/**
 * Placed attacks on the canvas (plan §18.3).
 *
 * An attack is drawn from its definition by `expandPlan` and is **indivisible**,
 * so its parts are inert: all interaction goes through one invisible **frame**
 * covering the instance's rectangle. The frame is what you click, drag and
 * transform, and it's what `SelectionTransformer` attaches to — so resizing an
 * attack is just resizing that rectangle, which is exactly what the model stores.
 *
 * The drawn parts stay in **absolute plan coordinates** with the frame kept
 * outside them. That matters: the WebM exporter drives these nodes by id with
 * absolute values, so they must not sit inside a transformed parent. During a
 * drag the parts are offset imperatively (never through React, plan §8.1) and
 * committed on drop.
 *
 * Attacks are placed on the board, not inside a slide, so every one of them
 * draws on every view — including the base layout, which is where you lay the
 * board out. The ones that fire on some *other* step are dimmed, so the current
 * moment reads clearly without hiding what else the encounter does.
 *
 * They are drawn *in the board's stacking order*, interleaved with the plan's
 * objects — `CanvasStage` walks one merged list. Drawing them all afterwards
 * put every attack's grab frame above every object, so an attack took every
 * click that landed in its rectangle no matter what the order said.
 */
const OTHER_STEP_OPACITY = 0.3;
/** A switched-off attack: still placeable, visibly not happening. */
const MUTED_OPACITY = 0.12;

/** One placed attack, ready to be dropped into the canvas at its place. */
export function PlacedAttackNode({ instanceId }: { instanceId: string }) {
  const instance = useEditorStore((s) =>
    s.attacks.find((a) => a.id === instanceId),
  );
  const def = useEditorStore((s) =>
    instance ? s.attackDefs[instance.attackId] : undefined,
  );
  const background = useEditorStore((s) => s.background);
  const currentStepId = useEditorStore((s) => s.steps[s.currentStepIndex]?.id);

  if (!instance || !def) return null;
  return (
    <PlacedAttack
      instance={instance}
      def={def}
      background={background}
      dimmed={instance.stepId !== currentStepId}
    />
  );
}

function PlacedAttack({
  instance,
  def,
  background,
  dimmed,
}: {
  instance: AttackInstance;
  def: AttackDef;
  background: Background;
  /** It fires on another step: still placeable, just not this moment. */
  dimmed: boolean;
}) {
  const muted = instance.visible === false;
  const selected = useEditorStore((s) =>
    s.selectedAttackIds.includes(instance.id),
  );
  const objects = useEditorStore((s) => s.objects);
  const objectIds = useEditorStore((s) => s.objectIds);
  const planObjects = useMemo(
    () =>
      objectIds
        .map((id) => objects[id])
        .filter((o): o is PlanObject => o !== undefined),
    [objectIds, objects],
  );
  const selectAttack = useEditorStore((s) => s.selectAttack);
  const updateAttack = useEditorStore((s) => s.updateAttack);
  const partsRef = useRef<GroupNode>(null);

  /** The attack's parts, already placed into the instance's rectangle. */
  const parts = useMemo(() => {
    const shell: Plan = {
      id: "attack-preview",
      title: "",
      raid: "",
      background,
      // The plan's own objects come along so a tether into one of them expands
      // to a real id; they aren't drawn from here (their own nodes do that).
      objects: planObjects,
      attacks: [{ ...instance, stepId: "s" }],
      steps: [{ id: "s", overrides: {}, animations: [] }],
      schemaVersion: SCHEMA_VERSION,
    };
    const expanded = expandPlan(shell, { [instance.attackId]: def });
    const own = new Set(planObjects.map((o) => o.id));
    return expanded.objects
      .filter((object) => !own.has(object.id))
      .map((object) => ({
        object,
        state: resolveObjectState(object, expanded.steps, 0),
      }));
  }, [instance, def, background, planObjects]);

  // The frame rotates about its centre, matching how a def's unit space is
  // mapped (§18.2) — so its position is the centre, offset by half its size.
  const half = { x: instance.w / 2, y: instance.h / 2 };

  const handleDragMove = (e: KonvaEventObject<DragEvent>) => {
    // Carry the parts along without a React render per frame.
    partsRef.current?.position({
      x: e.target.x() - (instance.x + half.x),
      y: e.target.y() - (instance.y + half.y),
    });
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    partsRef.current?.position({ x: 0, y: 0 });
    updateAttack(instance.id, {
      x: e.target.x() - half.x,
      y: e.target.y() - half.y,
    });
  };

  /** Konva resizes by scaling; fold that back into the rectangle. */
  const handleTransformEnd = (e: KonvaEventObject<Event>) => {
    const node = e.target;
    const w = Math.max(8, instance.w * node.scaleX());
    const h = Math.max(8, instance.h * node.scaleY());
    node.scaleX(1);
    node.scaleY(1);
    updateAttack(instance.id, {
      x: node.x() - w / 2,
      y: node.y() - h / 2,
      w,
      h,
      rotation: node.rotation(),
    });
  };

  return (
    <>
      <Group
        ref={partsRef}
        listening={false}
        opacity={muted ? MUTED_OPACITY : dimmed ? OTHER_STEP_OPACITY : 1}
      >
        {parts.map(({ object, state }) => (
          <ObjectVisual key={object.id} object={object} state={state} />
        ))}
      </Group>
      <Rect
        id={instance.id}
        x={instance.x + half.x}
        y={instance.y + half.y}
        offsetX={half.x}
        offsetY={half.y}
        width={instance.w}
        height={instance.h}
        rotation={instance.rotation}
        draggable={!instance.locked}
        // Transparent but hit-testable, so the whole attack is one grab target.
        fill="rgba(0,0,0,0.001)"
        stroke={selected ? "#f2c744" : undefined}
        strokeWidth={selected ? 1 : 0}
        dash={[6, 4]}
        strokeScaleEnabled={false}
        onMouseDown={() => selectAttack([instance.id])}
        onTap={() => selectAttack([instance.id])}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      />
    </>
  );
}
