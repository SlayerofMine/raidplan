import { AnimationPanel } from "./AnimationPanel";
import { CanvasStage } from "./canvas/CanvasStage";
import { IconPalette } from "./IconPalette";
import { isLocalPlan, LOCAL_PLAN_ID } from "./planScope";
import { PropertiesPanel } from "./PropertiesPanel";
import { SaveStatus } from "./SaveStatus";
import { SyncedIconResolver } from "./SyncedIconResolver";
import { StepStrip } from "./StepStrip";
import { Toolbar } from "./Toolbar";
import { useEditorHotkeys } from "./useEditorHotkeys";
import { useLocalPersistence } from "./useLocalPersistence";
import {
  useRemotePersistence,
  type RemoteStatus,
} from "./useRemotePersistence";

/**
 * The five-region editor shell (plan §1.1): toolbar across the top, palette /
 * canvas / properties in the middle row, steps strip along the bottom. The grid
 * gives the canvas all remaining space while the side panels keep a fixed width.
 */
export function EditorLayout({ planId }: { planId: string }) {
  useEditorHotkeys();
  const remote = usePersistence(planId);

  return (
    <div
      className="grid h-screen w-screen overflow-hidden text-neutral-100"
      style={{
        gridTemplateColumns: "14rem 1fr 18rem",
        gridTemplateRows: "auto 1fr auto",
        gridTemplateAreas: `
          "toolbar toolbar toolbar"
          "palette canvas  props"
          "steps   steps   steps"
        `,
      }}
    >
      <div style={{ gridArea: "toolbar" }}>
        <Toolbar
          // The viewer addresses plans by *slug*, not by the id in this URL —
          // and a server plan's slug is only known once it has loaded.
          viewHref={
            isLocalPlan(planId)
              ? `/view/${LOCAL_PLAN_ID}`
              : remote?.slug
                ? `/view/${remote.slug}`
                : null
          }
          status={<SaveStatus planId={planId} remote={remote} />}
        />
      </div>
      <div style={{ gridArea: "palette" }} className="min-h-0">
        <IconPalette />
      </div>
      <div style={{ gridArea: "canvas" }} className="min-h-0">
        <CanvasStage />
      </div>
      {/* Fetches URLs for synced WoW tokens a reopened plan references. */}
      <SyncedIconResolver />
      <div
        style={{ gridArea: "props" }}
        className="flex min-h-0 flex-col overflow-y-auto border-l border-panelborder bg-panel"
      >
        <PropertiesPanel />
        <AnimationPanel />
      </div>
      <div style={{ gridArea: "steps" }}>
        <StepStrip />
      </div>
    </div>
  );
}

/**
 * Persist to localStorage or the server depending on the plan.
 *
 * Both hooks are always called — hooks can't be conditional — so each is told
 * whether it's the active one rather than being skipped.
 */
function usePersistence(planId: string): RemoteStatus | null {
  const local = isLocalPlan(planId);
  useLocalPersistence(local);
  const remote = useRemotePersistence(local ? null : planId);
  return local ? null : remote;
}
