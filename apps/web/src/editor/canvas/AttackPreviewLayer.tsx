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
 * Attacks belong to a step, so nothing renders on the base layout.
 */
export function AttackPreviewLayer() {
  const steps = useEditorStore((s) => s.steps);
  const attackDefs = useEditorStore((s) => s.attackDefs);
  const background = useEditorStore((s) => s.background);
  const stepIndex = useEditorStore((s) => s.currentStepIndex);

  const instances = steps[stepIndex]?.attacks ?? [];
  if (instances.length === 0) return null;

  return (
    <>
      {instances.map((instance) => {
        const def = attackDefs[instance.attackId];
        if (!def) return null;
        return (
          <PlacedAttack
            key={instance.id}
            instance={instance}
            def={def}
            background={background}
            stepIndex={stepIndex}
          />
        );
      })}
    </>
  );
}

function PlacedAttack({
  instance,
  def,
  background,
  stepIndex,
}: {
  instance: AttackInstance;
  def: AttackDef;
  background: Background;
  stepIndex: number;
}) {
  const selected = useEditorStore((s) =>
    s.selectedAttackIds.includes(instance.id),
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
      objects: [],
      steps: [{ id: "s", overrides: {}, animations: [], attacks: [instance] }],
      schemaVersion: SCHEMA_VERSION,
    };
    const expanded = expandPlan(shell, { [instance.attackId]: def });
    return expanded.objects.map((object) => ({
      object,
      state: resolveObjectState(object, expanded.steps, 0),
    }));
  }, [instance, def, background]);

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
    updateAttack(stepIndex, instance.id, {
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
    updateAttack(stepIndex, instance.id, {
      x: node.x() - w / 2,
      y: node.y() - h / 2,
      w,
      h,
      rotation: node.rotation(),
    });
  };

  return (
    <>
      <Group ref={partsRef} listening={false}>
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
        draggable
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
