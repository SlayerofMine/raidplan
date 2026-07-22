import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  defToPlan,
  planToAttackContent,
  type AttackBindings,
  type AttackDef,
  type AttackParam,
} from "@raidplan/shared";
import { api } from "../api/client";
import { TetherButton } from "../editor/TetherButton";
import { AnimationPanel } from "../editor/AnimationPanel";
import { AttackParamsPanel } from "../editor/AttackParamsPanel";
import { AttackBoundsOverlay } from "../editor/canvas/AttackBoundsOverlay";
import { CanvasStage } from "../editor/canvas/CanvasStage";
import { IconPalette } from "../editor/IconPalette";
import { PropertiesPanel } from "../editor/PropertiesPanel";
import { SyncedIconResolver } from "../editor/SyncedIconResolver";
import { TimelineDock } from "../editor/timeline/TimelineDock";
import { useEditorHotkeys } from "../editor/useEditorHotkeys";
import {
  BASE_STEP_INDEX,
  clearHistory,
  useEditorStore,
} from "../store/editorStore";
import { Centered, RequireAdmin } from "./RequireAdmin";

/**
 * The attack designer (plan §17, stage 4).
 *
 * An {@link AttackDef} is a one-step mini-plan, so the designer *is* the editor:
 * `defToPlan` loads the def onto the shared store and the same canvas, palette
 * and panels author it. **Layout** edits the base placement (where the attack's
 * objects sit); **Animate** edits the single step — its end state (drag to set a
 * move/scale target) and its animations. `planToAttackContent` reads it back on
 * save. Unlike the plan editor, nothing here auto-persists as a plan.
 */
const DEFAULT_SIZE = { w: 400, h: 400 };

function blankDef(encounterId: string): AttackDef {
  return {
    id: "",
    encounterId,
    name: "New attack",
    version: 1,
    defaultSize: DEFAULT_SIZE,
    objects: [],
    overrides: {},
    animations: [],
    params: [],
    bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
  };
}

export function AttackDesignerPage() {
  const { attackId, encounterId } = useParams<{
    attackId?: string;
    encounterId?: string;
  }>();
  const next = attackId
    ? `/admin/attacks/${attackId}`
    : `/admin/encounters/${encounterId}/attacks/new`;
  return (
    <RequireAdmin next={next}>
      <AttackDesigner attackId={attackId} encounterId={encounterId} />
    </RequireAdmin>
  );
}

function AttackDesigner({
  attackId,
  encounterId,
}: {
  attackId?: string;
  encounterId?: string;
}) {
  useEditorHotkeys();
  const navigate = useNavigate();
  const selectStep = useEditorStore((s) => s.selectStep);
  const onBase = useEditorStore((s) => s.currentStepIndex === BASE_STEP_INDEX);

  const [def, setDef] = useState<AttackDef | null>(null);
  const [name, setName] = useState("");
  // Declared parameters and their bindings aren't spatial, so they live beside
  // the canvas rather than in it — and must survive a save untouched.
  const [params, setParams] = useState<AttackParam[]>([]);
  const [bindings, setBindings] = useState<AttackBindings>({
    collideWith: {},
    durationMs: {},
    delayMs: {},
    tint: {},
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the def (fetched for edit, blank for new) onto the store, once.
  useEffect(() => {
    let cancelled = false;
    const apply = (d: AttackDef) => {
      if (cancelled) return;
      setDef(d);
      setName(d.name);
      setParams(d.params);
      setBindings(d.bindings);
      useEditorStore.getState().loadPlan(defToPlan(d));
      clearHistory();
      useEditorStore.getState().selectStep(BASE_STEP_INDEX);
    };
    if (attackId) {
      api.attack.get
        .query({ id: attackId })
        .then(apply)
        .catch(() => setError("Could not load that attack."));
    } else if (encounterId) {
      apply(blankDef(encounterId));
    }
    return () => {
      cancelled = true;
    };
  }, [attackId, encounterId]);

  const save = async () => {
    if (!def) return;
    setSaving(true);
    setError(null);
    try {
      const plan = useEditorStore.getState().getPlan();
      const content = planToAttackContent(plan, {
        name: name.trim() || "Attack",
        params,
        bindings,
      });
      if (attackId)
        await api.attack.update.mutate({ id: attackId, ...content });
      else
        await api.attack.create.mutate({
          encounterId: def.encounterId,
          ...content,
        });
      navigate(`/admin/encounters/${def.encounterId}/attacks`);
    } catch {
      setError("Could not save the attack.");
      setSaving(false);
    }
  };

  if (error && !def) return <Centered>{error}</Centered>;
  if (!def) return <Centered>Loading…</Centered>;

  return (
    <div
      className="grid h-screen w-screen overflow-hidden text-neutral-100"
      style={{
        gridTemplateColumns: "14rem 1fr 18rem",
        gridTemplateRows: "auto 1fr auto",
        gridTemplateAreas: `
          "toolbar toolbar toolbar"
          "palette canvas  props"
          "timeline timeline timeline"
        `,
      }}
    >
      <div
        style={{ gridArea: "toolbar" }}
        className="flex flex-wrap items-center gap-2 border-b border-panelborder bg-panel px-3 py-2"
      >
        <Link
          to={`/admin/encounters/${def.encounterId}/attacks`}
          className="text-sm text-accent hover:underline"
        >
          ← Attacks
        </Link>
        <input
          aria-label="Attack name"
          data-testid="attack-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm"
        />

        <TetherButton />

        <div className="flex overflow-hidden rounded border border-panelborder text-xs">
          <button
            type="button"
            data-testid="mode-layout"
            onClick={() => selectStep(BASE_STEP_INDEX)}
            className={`px-2 py-1 ${onBase ? "bg-accent text-neutral-950" : "hover:bg-neutral-800"}`}
          >
            Layout
          </button>
          <button
            type="button"
            data-testid="mode-animate"
            onClick={() => selectStep(0)}
            className={`px-2 py-1 ${onBase ? "hover:bg-neutral-800" : "bg-accent text-neutral-950"}`}
          >
            Animate
          </button>
        </div>

        {error && (
          <span data-testid="designer-error" className="text-xs text-amber-400">
            {error}
          </span>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          data-testid="save-attack"
          className="ml-auto rounded bg-accent px-3 py-1 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save attack"}
        </button>
      </div>

      <div style={{ gridArea: "palette" }} className="min-h-0">
        <IconPalette />
      </div>
      <div style={{ gridArea: "canvas" }} className="min-h-0">
        {/* The dashed box is the attack: what a planner grabs, and the size
            stored as its `defaultSize`. Measured, never typed. */}
        <CanvasStage overlay={<AttackBoundsOverlay />} />
      </div>
      <SyncedIconResolver />
      <div
        style={{ gridArea: "props" }}
        className="flex min-h-0 flex-col overflow-y-auto border-l border-panelborder bg-panel"
      >
        <PropertiesPanel />
        <AnimationPanel />
        <AttackParamsPanel
          params={params}
          bindings={bindings}
          onParamsChange={setParams}
          onBindingsChange={setBindings}
        />
      </div>
      <div style={{ gridArea: "timeline" }} className="flex min-h-0 flex-col">
        <TimelineDock />
      </div>
    </div>
  );
}
