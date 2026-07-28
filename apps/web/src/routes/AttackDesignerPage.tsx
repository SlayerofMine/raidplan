import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ATTACK_END_SLIDE,
  defToPlan,
  planToAttackContent,
  scopeEncounterId,
  type AttackBindings,
  type AttackDef,
  type AttackParam,
  type Follow,
} from "@raidplan/shared";
import { api } from "../api/client";
import { TetherButton } from "../editor/TetherButton";
import { AnimationPanel } from "../editor/AnimationPanel";
import {
  AttackFollowPanel,
  AttackParamsPanel,
} from "../editor/AttackParamsPanel";
import { AttackBoundsOverlay } from "../editor/canvas/AttackBoundsOverlay";
import { CanvasStage } from "../editor/canvas/CanvasStage";
import { IconPalette } from "../editor/IconPalette";
import { PropertiesPanel } from "../editor/PropertiesPanel";
import { SyncedIconResolver } from "../editor/SyncedIconResolver";
import { TimelineDock } from "../editor/timeline/TimelineDock";
import { useEditorHotkeys } from "../editor/useEditorHotkeys";
import { clearHistory, useEditorStore } from "../store/editorStore";
import { Centered, RequireAdmin } from "./RequireAdmin";

/**
 * The attack designer (plan §17, stage 4).
 *
 * An {@link AttackDef} is a one-slide mini-plan, so the designer *is* the editor:
 * `defToPlan` loads the def onto the shared store and the same canvas, palette
 * and panels author it. **Layout** edits the base placement (where the attack's
 * objects sit); **Animate** edits the single slide — its end state (drag to set a
 * move/scale target) and its animations. `planToAttackContent` reads it back on
 * save. Unlike the plan editor, nothing here auto-persists as a plan.
 */
const DEFAULT_SIZE = { w: 400, h: 400 };

function blankDef(encounterId: string): AttackDef {
  return {
    id: "",
    scope: { kind: "encounter", encounterId },
    name: "New attack",
    version: 1,
    defaultSize: DEFAULT_SIZE,
    objects: [],
    // A def's one slide, empty: nothing settles anywhere until something is
    // drawn. `defToPlan` gives it the designer's End identity either way.
    slides: [{ id: ATTACK_END_SLIDE, name: "End", states: {}, animations: [] }],
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
  const selectSlide = useEditorStore((s) => s.selectSlide);
  // `defToPlan` lays a definition out as exactly two slides: slide 0 is the
  // shape the attack starts as, slide 1 what its animations turn it into. So
  // "Layout" and "Animate" are simply which of the two you are editing.
  const onStart = useEditorStore((s) => s.currentSlideIndex === 0);
  // The holes this definition leaves, for the follow panel to name.
  const objects = useEditorStore((s) => s.objects);
  const objectIds = useEditorStore((s) => s.objectIds);
  const slots = useMemo(
    () =>
      objectIds
        .map((id) => objects[id])
        .filter((o) => o?.type === "placeholder")
        .map((o) => ({ id: o!.id, label: o!.base.name ?? "Slot" })),
    [objectIds, objects],
  );

  const [def, setDef] = useState<AttackDef | null>(null);
  const [name, setName] = useState("");
  // Declared parameters and their bindings aren't spatial, so they live beside
  // the canvas rather than in it — and must survive a save untouched.
  const [params, setParams] = useState<AttackParam[]>([]);
  // The whole bundle's origin, direction and what it follows. A *part* that
  // follows something is set in the properties panel like any other object —
  // after §18.17 there is no separate look-at to keep here.
  const [follow, setFollow] = useState<Follow | undefined>(undefined);
  const [origin, setOrigin] = useState<{
    ox?: number;
    oy?: number;
    dir?: number;
  }>({});
  const [bindings, setBindings] = useState<AttackBindings>({
    collideWith: {},
    durationMs: {},
    delayMs: {},
    tint: {},
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The two slides are the *same* scene in two states (see `onStart`), not two
  // scenes, so a part drawn on either belongs to both — unlike a plan, where a
  // slide owns its own cast.
  useEffect(() => {
    useEditorStore.getState().setSharedCast(true);
    return () => useEditorStore.getState().setSharedCast(false);
  }, []);

  // Load the def (fetched for edit, blank for new) onto the store, once.
  useEffect(() => {
    let cancelled = false;
    const apply = (d: AttackDef) => {
      if (cancelled) return;
      setDef(d);
      setName(d.name);
      setParams(d.params);
      setBindings(d.bindings);
      setFollow(d.follow);
      setOrigin({ ox: d.ox, oy: d.oy, dir: d.dir });
      useEditorStore.getState().loadPlan(defToPlan(d));
      clearHistory();
      useEditorStore.getState().selectSlide(0);
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

  // Where this attack lives, which for now is always an encounter's library —
  // read off the def rather than the route, since editing arrives by id alone.
  const home = scopeEncounterId(def?.scope ?? { kind: "plan", planId: "" });

  const save = async () => {
    if (!def || !home) return;
    setSaving(true);
    setError(null);
    try {
      const plan = useEditorStore.getState().getPlan();
      const content = planToAttackContent(plan, {
        name: name.trim() || "Attack",
        params,
        bindings,
        follow,
        ...origin,
      });
      if (attackId)
        await api.attack.update.mutate({ id: attackId, ...content });
      // The scope the designer was opened in — an encounter's library today,
      // a plan's own once §19.3 routes it there.
      else await api.attack.create.mutate({ scope: def.scope, ...content });
      navigate(`/admin/encounters/${home}/attacks`);
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
          to={`/admin/encounters/${home}/attacks`}
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
            onClick={() => selectSlide(0)}
            className={`px-2 py-1 ${onStart ? "bg-accent text-neutral-950" : "hover:bg-neutral-800"}`}
          >
            Layout
          </button>
          <button
            type="button"
            data-testid="mode-animate"
            onClick={() => selectSlide(1)}
            className={`px-2 py-1 ${onStart ? "hover:bg-neutral-800" : "bg-accent text-neutral-950"}`}
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
        <IconPalette authoring />
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
        <AttackFollowPanel
          slots={slots}
          follow={follow}
          ox={origin.ox}
          oy={origin.oy}
          dir={origin.dir}
          onFollowChange={setFollow}
          onOriginChange={(p) => setOrigin((o) => ({ ...o, ...p }))}
        />
      </div>
      <div style={{ gridArea: "timeline" }} className="flex min-h-0 flex-col">
        <TimelineDock />
      </div>
    </div>
  );
}
