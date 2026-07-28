import { useState } from "react";
import {
  planToAttackContent,
  selectionToAttackPlan,
  type SelectionLeftBehind,
} from "@raidplan/shared";
import { api } from "../api/client";
import { useEditorStore } from "../store/editorStore";
import { useToast } from "../ui/toastContext";
import { isLocalPlan } from "./planScope";
import { Btn } from "./ToolbarButton";

/**
 * "Save as attack" — the selection becomes a definition (plan §19.3).
 *
 * The payoff of §18.1: by the time an author asks for this, the work is done.
 * They have already dragged the circles into a cone and animated them, and
 * grouping gave them the word for the assembled thing — so this reads the
 * assembly rather than making them redraw it in the designer.
 *
 * **Saving is not converting.** The objects stay exactly where they are and
 * remain individually editable; a definition is copied *out*. Replacing them
 * with an instance is a separate thing to ask for, because it is destructive in
 * the one way that matters — an attack is indivisible, so its parts stop being
 * editable the moment they become one.
 *
 * It also **stays in the plan**. Sending the author into the designer to admire
 * what they just captured would leave the plan's own debounced autosave in mid
 * air, so the tidier flourish costs unsaved work; the palette is one click away
 * when they actually want to edit it.
 */
export function SaveAsAttackButton() {
  const planId = useEditorStore((s) => s.id);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Nothing to save from an empty selection, and nowhere to save it to on the
  // offline scratch plan — a definition lives in a scope, and `local` has none.
  const disabled = selectedIds.length === 0 || isLocalPlan(planId);

  const save = async () => {
    setSaving(true);
    try {
      const state = useEditorStore.getState();
      const { plan, leftBehind } = selectionToAttackPlan(
        state.getPlan(),
        state.selectedIds,
        state.currentSlideIndex,
      );
      const content = planToAttackContent(plan, {
        name: name.trim() || "New attack",
      });
      const def = await api.attack.create.mutate({
        scope: { kind: "plan", planId },
        ...content,
      });
      setNaming(false);
      setName("");
      toast(saidWhat(def.name, leftBehind), "success");
    } catch {
      toast("Could not save that as an attack.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!naming) {
    return (
      <Btn
        onClick={() => setNaming(true)}
        disabled={disabled}
        label="Save as attack"
        title={
          isLocalPlan(planId)
            ? "Save this plan to the server first"
            : "Turn the selection into a reusable attack in this plan"
        }
      />
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        aria-label="New attack name"
        data-testid="new-attack-name"
        autoFocus
        value={name}
        placeholder="Attack name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setNaming(false);
        }}
        className="w-36 rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm"
      />
      <Btn
        onClick={() => void save()}
        disabled={saving}
        label={saving ? "Saving…" : "Save"}
        ariaLabel="Save attack"
      />
      <Btn onClick={() => setNaming(false)} label="Cancel" />
    </span>
  );
}

/**
 * What to tell the author. A collision target that named one of the plan's own
 * objects cannot come along — a definition reaches the plan only through a
 * parameter (§18.4) — so say which, rather than quietly dropping it.
 */
function saidWhat(name: string, leftBehind: SelectionLeftBehind): string {
  if (leftBehind.collideWith.length === 0) return `Saved “${name}”.`;
  const targets = [...new Set(leftBehind.collideWith)].join(", ");
  return `Saved “${name}”. Collisions with ${targets} were left behind — add a parameter for them.`;
}
