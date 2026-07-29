import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PlanSchema, type AttackParam, type Plan } from "@raidplan/shared";
import { api } from "../api/client";
import { useSession } from "../api/useSession";
import { EditorLayout } from "../editor/EditorLayout";
import { isLocalPlan, LOCAL_PLAN_ID } from "../editor/planScope";
import {
  attackToPlan,
  planToAttack,
  upsertAttack,
} from "../editor/designer/attackDocument";
import { clearHistory, useEditorStore } from "../store/editorStore";
import {
  loadPlan as loadLocalPlan,
  savePlan as saveLocalPlan,
} from "../store/persistence";
import { nextAttackDefId } from "../store/ids";

/**
 * `/plan/:id/attack/:attackId` — the Attack Designer (plan §21).
 *
 * **The ordinary editor, in a sandbox.** A definition is a slice of a Plan, so
 * opening one is a matter of wrapping its objects and its slide in a plan and
 * handing that to the store; the canvas, the properties column, the timeline and
 * the player all behave exactly as they do for a plan, because as far as they
 * are concerned it *is* one.
 *
 * A **separate route**, deliberately. The store is a singleton and the
 * persistence hooks subscribe to it, so a designer that opened alongside the
 * editor would have the sandbox autosaved over the plan the moment anything
 * moved. Unmounting the editor takes its autosave with it, which is the only
 * arrangement where that cannot happen.
 *
 * The parent plan is held in a **ref**, never in the store: exactly one document
 * is open at a time, and saving is a splice into the copy this page is holding
 * followed by the same `plan.saveDoc` every other save uses. Nothing new
 * persists anything.
 */
export function DesignerPage() {
  const { id, attackId } = useParams<{ id: string; attackId: string }>();
  const planId = id ?? LOCAL_PLAN_ID;
  const navigate = useNavigate();

  const parent = useRef<Plan | null>(null);
  const version = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [name, setName] = useState("New attack");
  const [params, setParams] = useState<AttackParam[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useSession();
  // Minted once, so saving twice updates one definition rather than making two.
  const defId = useRef(
    attackId === "new" ? nextAttackDefId() : (attackId ?? ""),
  );

  useEffect(() => {
    let cancelled = false;

    const open = (plan: Plan) => {
      if (cancelled) return;
      parent.current = plan;
      const def = plan.attacks.find((a) => a.id === defId.current);
      setName(def?.name ?? "New attack");
      setParams(def ? [...def.params] : []);
      useEditorStore.getState().loadPlan(attackToPlan(plan, def));
      // Undo must not be able to reach back past the load into whatever
      // document the store held before it.
      clearHistory();
      setStatus("ready");
    };

    // The store still holds the plan the editor was just showing, and it is
    // **fresher than storage**: autosave is debounced a second, so opening the
    // designer straight after an edit would otherwise read a document without
    // it and write that back over the top. Taking it from memory is both fresher
    // and free of the race; the fetch below is only for a deep link, and — for a
    // server plan — for the version the save has to check against.
    const held = useEditorStore.getState().getPlan();
    const inMemory = held.id === planId ? held : undefined;

    if (isLocalPlan(planId)) {
      const local = inMemory ?? loadLocalPlan();
      if (local) open(local);
      else setStatus("error");
      return () => {
        cancelled = true;
      };
    }

    api.plan.get
      .query({ id: planId })
      .then((row) => {
        version.current = row.version;
        open(inMemory ?? PlanSchema.parse(row.doc));
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const back = useCallback(
    () => navigate(`/plan/${planId}/edit`),
    [navigate, planId],
  );

  /** The definition as the sandbox currently has it. */
  const current = useCallback(
    () =>
      planToAttack(
        useEditorStore.getState().getPlan(),
        {
          id: defId.current,
          name,
          // Authored inside a plan, so it belongs to that plan. Publishing one
          // to an encounter is a separate, admin-only act (§21.7), and the
          // server is what marks a published definition as coming from the map.
          source: "plan",
        },
        params,
      ),
    [name, params],
  );

  /** Write the definition into the plan's own library and go back. */
  const save = useCallback(async () => {
    const plan = parent.current;
    if (!plan) return;
    setSaving(true);
    setError(null);
    const next = upsertAttack(plan, current());

    try {
      if (isLocalPlan(planId)) {
        if (!saveLocalPlan(next)) throw new Error("storage unavailable");
      } else {
        const result = await api.plan.saveDoc.mutate({
          id: planId,
          doc: next,
          ...(version.current !== undefined
            ? { expectedVersion: version.current }
            : {}),
        });
        version.current = result.version;
      }
      back();
    } catch {
      setError(
        "Couldn't save the attack. The plan may have changed elsewhere.",
      );
      setSaving(false);
    }
  }, [back, current, planId]);

  /**
   * Ship this attack with the map the plan was made from (plan §21).
   *
   * Admin-only, and deliberately separate from Save: it reaches every plan made
   * from this encounter **in future**, and none that already exist. It saves
   * into the plan as well, so publishing never leaves the plan itself without
   * the thing that was just published.
   */
  const publish = useCallback(async () => {
    const encounterId = parent.current?.encounterId;
    if (!encounterId) return;
    setSaving(true);
    setError(null);
    try {
      await api.encounter.publishAttack.mutate({
        id: encounterId,
        attack: current(),
      });
    } catch {
      setError("Couldn't publish this attack to the map.");
      setSaving(false);
      return;
    }
    await save();
  }, [current, save]);

  if (status === "loading") {
    return (
      <p
        className="p-6 text-sm text-neutral-400"
        data-testid="designer-loading"
      >
        Opening the designer…
      </p>
    );
  }
  if (status === "error") {
    return (
      <div className="p-6 text-sm text-neutral-400">
        <p data-testid="designer-error">That plan couldn't be opened.</p>
        <button
          type="button"
          onClick={back}
          className="mt-2 text-accent hover:underline"
        >
          Back to the plan
        </button>
      </div>
    );
  }

  return (
    <EditorLayout
      planId={planId}
      designer={{
        name,
        onNameChange: setName,
        params,
        onParamsChange: setParams,
        onSave: () => void save(),
        onDiscard: back,
        saving,
        error,
        // Only an admin, and only for a plan that came from a map — there is
        // nowhere to publish a scratch plan's attack to.
        ...(session.status === "signedIn" &&
        session.session.isAdmin &&
        parent.current?.encounterId
          ? { onPublish: () => void publish() }
          : {}),
      }}
    />
  );
}
