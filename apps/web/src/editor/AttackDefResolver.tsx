import { useEffect } from "react";
import type { AttackDef } from "@raidplan/shared";
import { api } from "../api/client";
import { useEditorStore } from "../store/editorStore";

/**
 * Loads the attack definitions this plan may use into the store (plan §17).
 *
 * A plan references attacks by id, so both the canvas preview and the WebM
 * export need the defs to expand them. Fetching once here — for the plan's
 * encounter — keeps a single copy in ephemeral store state instead of each
 * consumer fetching its own. Renders nothing; a plan with no encounter never
 * touches the network.
 */
export function AttackDefResolver() {
  const encounterId = useEditorStore((s) => s.encounterId);
  const setAttackDefs = useEditorStore((s) => s.setAttackDefs);

  useEffect(() => {
    if (!encounterId) return;
    let cancelled = false;
    api.attack.listForEncounter
      .query({ encounterId })
      .then((defs) => {
        if (cancelled) return;
        const byId: Record<string, AttackDef> = {};
        for (const def of defs) byId[def.id] = def;
        setAttackDefs(byId);
      })
      .catch(() => {
        // A plan still edits fine without its attack art; the panel says so.
      });
    return () => {
      cancelled = true;
    };
  }, [encounterId, setAttackDefs]);

  return null;
}
