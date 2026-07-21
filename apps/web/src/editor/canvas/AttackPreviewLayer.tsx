import { useMemo } from "react";
import {
  expandPlan,
  resolveObjectState,
  SCHEMA_VERSION,
  type Plan,
} from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { ObjectVisual } from "./ObjectVisual";

/**
 * Draws the attacks placed on this plan (plan §17, stage 5).
 *
 * A placed attack is only an id and a transform, so its parts are materialised
 * here by `expandPlan` — run against a shell plan holding *just* the steps, so
 * everything it returns is attack content. Each expanded object is drawn
 * read-only at its resolved state, exactly as the viewer and the share preview
 * draw it, and carries its real id: that's what lets the WebM exporter animate
 * and capture these nodes like any other.
 *
 * They're inert — an attack is indivisible, so there's nothing here to select or
 * drag. The Attacks panel is where an instance is retuned. Nothing renders on
 * the base layout: attacks belong to a step.
 */
export function AttackPreviewLayer() {
  const steps = useEditorStore((s) => s.steps);
  const attackDefs = useEditorStore((s) => s.attackDefs);
  const background = useEditorStore((s) => s.background);
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex);

  const expanded = useMemo(() => {
    const shell: Plan = {
      id: "attack-preview",
      title: "",
      raid: "",
      background,
      objects: [],
      steps,
      schemaVersion: SCHEMA_VERSION,
    };
    return expandPlan(shell, attackDefs);
  }, [steps, attackDefs, background]);

  if (expanded.objects.length === 0) return null;

  return (
    <>
      {expanded.objects.map((object) => (
        <ObjectVisual
          key={object.id}
          object={object}
          state={resolveObjectState(object, expanded.steps, currentStepIndex)}
        />
      ))}
    </>
  );
}
