import type { ReactNode } from "react";
import { AnimationPanel } from "./AnimationPanel";
import { AttackDefResolver } from "./AttackDefResolver";
import { AttacksPanel } from "./AttacksPanel";
import { CanvasStage } from "./canvas/CanvasStage";
import { EmptySlideHint } from "./EmptySlideHint";
import { IconPalette } from "./IconPalette";
import { isLocalPlan, LOCAL_PLAN_ID } from "./planScope";
import { ObjectsPanel } from "./ObjectsPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { SaveStatus } from "./SaveStatus";
import { SyncedIconResolver } from "./SyncedIconResolver";
import { SlideStrip } from "./SlideStrip";
import { PlaybackLockNotice } from "./timeline/PlaybackLockNotice";
import { selectPlaybackLocked, usePlayhead } from "./timeline/playhead";
import { TimelineDock } from "./timeline/TimelineDock";
import { useEditorPlayhead } from "./timeline/useEditorPlayhead";
import { Toolbar } from "./Toolbar";
import { useEditorHotkeys } from "./useEditorHotkeys";
import { useLocalPersistence } from "./useLocalPersistence";
import {
  useRemotePersistence,
  type RemoteStatus,
} from "./useRemotePersistence";

/**
 * The five-region editor shell (plan §1.1): toolbar across the top, palette /
 * canvas / properties in the middle row, slides strip along the bottom. The grid
 * gives the canvas all remaining space while the side panels keep a fixed width.
 *
 * It is also where the editing lock is applied. While the Timeline's playhead is
 * off zero the canvas shows a frame of the slide's animation rather than the
 * slide as stored, so every region that writes to the document is disabled —
 * everything but the Timeline dock itself, which is how you get back.
 */
export function EditorLayout({ planId }: { planId: string }) {
  useEditorHotkeys();
  useEditorPlayhead();
  const remote = usePersistence(planId);
  const locked = usePlayhead(selectPlaybackLocked);

  return (
    <div
      className="grid h-screen w-screen overflow-hidden text-neutral-100"
      style={{
        gridTemplateColumns: "14rem 1fr 18rem",
        gridTemplateRows: "auto 1fr auto",
        gridTemplateAreas: `
          "toolbar toolbar toolbar"
          "palette canvas  props"
          "slides   slides   slides"
        `,
      }}
    >
      <Locked disabled={locked} style={{ gridArea: "toolbar" }}>
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
      </Locked>
      <Locked
        disabled={locked}
        style={{ gridArea: "palette" }}
        className="min-h-0"
      >
        <IconPalette />
      </Locked>
      <div style={{ gridArea: "canvas" }} className="relative min-h-0">
        <CanvasStage />
        {!locked && <EmptySlideHint />}
        <PlaybackLockNotice />
      </div>
      {/* Fetches URLs for synced WoW tokens a reopened plan references. */}
      <SyncedIconResolver />
      {/* Loads this encounter's attack definitions for the preview + export. */}
      <AttackDefResolver />
      <Locked
        disabled={locked}
        style={{ gridArea: "props" }}
        className="flex min-h-0 flex-col overflow-y-auto border-l border-panelborder bg-panel"
      >
        <ObjectsPanel />
        <PropertiesPanel />
        <AnimationPanel />
        <AttacksPanel />
      </Locked>
      <div style={{ gridArea: "slides" }} className="flex min-h-0 flex-col">
        {/* The strip locks with everything else; the dock below it never does,
            because it carries Stop. */}
        <Locked disabled={locked} className="min-h-0">
          <SlideStrip />
        </Locked>
        <TimelineDock />
      </div>
    </div>
  );
}

/**
 * A region of the shell that switches off while the playhead is live.
 *
 * A `fieldset` rather than a pile of `disabled` props: the browser disables
 * every control inside it, including ones added later, so no panel can quietly
 * stay editable by forgetting to thread a flag through. `min-w-0` because a
 * fieldset's default `min-width: min-content` would otherwise refuse to shrink
 * inside the grid.
 */
function Locked({
  disabled,
  className,
  style,
  children,
}: {
  disabled: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <fieldset
      disabled={disabled}
      data-locked={disabled || undefined}
      style={style}
      className={`min-w-0 disabled:opacity-50 ${className ?? ""}`}
    >
      {children}
    </fieldset>
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
