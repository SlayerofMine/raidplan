import { useCallback } from "react";
import { attackSlots, type AttackDef } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { useToast } from "../ui/toastContext";
import type { Point } from "./canvas/coords";

/**
 * Placing an attack, and saying why when it can't be (plan §21).
 *
 * The store answers only yes or no — "which objects" is a question about the
 * selection, and refusing is the store's business while *explaining* is the
 * UI's. Both ways of placing one (clicking a palette tile, dropping it on the
 * canvas) come through here, so they can never disagree about the rule or about
 * how it reads.
 */

/** What the planner has to have selected before this attack will go anywhere. */
export function slotRequirement(def: AttackDef): string | undefined {
  const slots = attackSlots(def.objects);
  if (slots.length === 0) return undefined;
  const names = slots.map((slot) => slot.slotName).filter(Boolean);
  return names.length === slots.length ? names.join(", ") : `${slots.length}`;
}

export function useAttackPlacement(): (defId: string, at: Point) => void {
  const { toast } = useToast();

  return useCallback(
    (defId: string, at: Point) => {
      const state = useEditorStore.getState();
      const def = state.attacks.find((a) => a.id === defId);
      if (!def) return;

      if (state.placeAttack(defId, at) !== undefined) return;

      // The only way placement fails for a definition the plan has: the wrong
      // number of objects selected to fill its slots. Name them, because "one
      // object" is much less use than "the tank".
      const slots = attackSlots(def.objects);
      const wanted =
        slots.length === 1
          ? (slots[0]!.slotName ?? "one object")
          : slots.map((slot) => slot.slotName ?? "an object").join(", ");
      toast(
        slots.length === 0
          ? `${def.name} could not be placed here.`
          : `Select ${wanted} to place ${def.name}.`,
        "error",
      );
    },
    [toast],
  );
}
