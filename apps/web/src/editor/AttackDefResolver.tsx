import { useEffect } from "react";
import type { AttackDef } from "@raidplan/shared";
import { api } from "../api/client";
import { useEditorStore } from "../store/editorStore";
import { isLocalPlan } from "./planScope";

/**
 * Loads the attack definitions this plan may use into the store (plan §17,
 * widened in §19.4).
 *
 * Two libraries, one map: the **encounter's** curated attacks, and the plan's
 * **own** (§19.1). Ids are UUIDs, so the two cannot collide, and every consumer
 * downstream of the map — `expandPlan`, the canvas preview, the WebM export,
 * `useFollowing` — is unchanged by there being two sources.
 *
 * Fetching once here keeps a single copy in ephemeral store state instead of
 * each consumer fetching its own. Renders nothing. The offline scratch plan has
 * no server-side attacks of either kind, so it still never touches the network —
 * but a plan with no *encounter* now has its own section rather than nothing.
 */
export function AttackDefResolver({ planId }: { planId: string }) {
  const encounterId = useEditorStore((s) => s.encounterId);
  const setAttackDefs = useEditorStore((s) => s.setAttackDefs);

  useEffect(() => {
    const remote = !isLocalPlan(planId);
    if (!encounterId && !remote) return;
    let cancelled = false;

    const sources: Promise<AttackDef[]>[] = [];
    if (encounterId) {
      sources.push(api.attack.listForEncounter.query({ encounterId }));
    }
    if (remote) sources.push(api.attack.listForPlan.query({ planId }));

    // `allSettled`, not `all`: the plan's own attacks failing to arrive is no
    // reason to lose the encounter's as well, and the other way round. A plan
    // still edits fine without its attack art — the palette says so.
    void Promise.allSettled(sources).then((results) => {
      if (cancelled) return;
      const byId: Record<string, AttackDef> = {};
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const def of result.value) byId[def.id] = def;
      }
      setAttackDefs(byId);
    });

    return () => {
      cancelled = true;
    };
  }, [encounterId, planId, setAttackDefs]);

  return null;
}
