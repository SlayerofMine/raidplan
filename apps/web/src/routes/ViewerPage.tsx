import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Stage as StageNode } from "konva/lib/Stage";
import { api } from "../api/client";
import { useFps } from "../anim/useFps";
import { usePlayback } from "../anim/usePlayback";
import { isEditableTarget } from "../editor/isEditableTarget";
import { isLocalPlan, LOCAL_PLAN_ID } from "../editor/planScope";
import { clearHistory, useEditorStore } from "../store/editorStore";
import { loadPlan } from "../store/persistence";
import { PlaybackControls } from "../viewer/PlaybackControls";
import { useStageRecorder } from "../viewer/useStageRecorder";
import { ViewerStage } from "../viewer/ViewerStage";

type LoadState = "loading" | "ready" | "missing";

/**
 * `/view/:slug` — read-only playback (plan §3.6 / §4.6).
 *
 * The reserved `local` slug plays the offline plan from this browser; any other
 * slug is fetched from the server, which enforces visibility: `unlisted` and
 * `public` need no account, `private` needs guild membership (plan §10). A slug
 * you may not see is indistinguishable from one that doesn't exist.
 *
 * The shareable URL is `/p/:slug` — the API serves that with Open Graph meta
 * for Discord and forwards people here.
 */
export function ViewerPage() {
  const { slug = LOCAL_PLAN_ID } = useParams<{ slug: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageNode>(null);
  const [load, setLoad] = useState<LoadState>("loading");

  const title = useEditorStore((s) => s.title);
  const steps = useEditorStore((s) => s.steps);
  const playback = usePlayback(stageRef);
  const fps = useFps(playback.isPlaying);
  const recorder = useStageRecorder(stageRef, title);

  /**
   * Recording captures whatever the board does, so starting one replays the
   * current step from the top — otherwise the clip would open mid-animation.
   * Advance steps while it runs to capture more than one.
   */
  const toggleRecording = () => {
    if (recorder.isRecording) {
      recorder.stop();
      return;
    }
    if (recorder.start()) playback.restart();
  };

  // Load once, before playback builds its first timeline.
  useEffect(() => {
    let cancelled = false;

    if (isLocalPlan(slug)) {
      const saved = loadPlan();
      if (saved) {
        useEditorStore.getState().loadPlan(saved);
        clearHistory();
      }
      setLoad(saved ? "ready" : "missing");
      return;
    }

    setLoad("loading");
    api.plan.getBySlug
      .query({ slug })
      .then((plan) => {
        if (cancelled) return;
        useEditorStore.getState().loadPlan(plan.doc);
        clearHistory();
        setLoad("ready");
      })
      .catch(() => {
        if (!cancelled) setLoad("missing");
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Keyboard transport: ←/→ steps, space play/pause (plan §7).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowRight") playback.next();
      else if (e.key === "ArrowLeft") playback.previous();
      else if (e.code === "Space") {
        e.preventDefault();
        playback.toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playback]);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const stepName =
    steps[playback.stepIndex]?.name ?? `Step ${playback.stepIndex + 1}`;

  return (
    <div
      ref={containerRef}
      className="flex h-screen w-screen flex-col bg-[#0b0d12] text-neutral-100"
    >
      <header className="flex items-center gap-2 border-b border-panelborder bg-panel px-3 py-2">
        <span className="font-semibold" data-testid="viewer-title">
          {load === "missing" ? "Not found" : title}
        </span>
        {playback.isPlaying && (
          <span
            className="text-xs tabular-nums text-neutral-500"
            data-testid="fps"
            title="Frames per second during playback"
          >
            {fps} fps
          </span>
        )}
        {isLocalPlan(slug) && (
          <Link
            to={`/plan/${LOCAL_PLAN_ID}/edit`}
            className="ml-auto text-sm text-neutral-400 hover:text-accent"
          >
            Edit
          </Link>
        )}
      </header>

      <main className="min-h-0 flex-1">
        {load === "missing" ? (
          <p data-testid="viewer-missing" className="p-8 text-neutral-500">
            This plan doesn&apos;t exist, or isn&apos;t shared with you.
          </p>
        ) : load === "ready" && steps.length === 0 ? (
          <p data-testid="viewer-empty" className="p-8 text-neutral-500">
            This plan has no steps yet. Add some in the editor.
          </p>
        ) : (
          <ViewerStage
            stageRef={stageRef}
            clickableObjectIds={playback.clickableObjectIds}
            onObjectClick={playback.triggerClick}
          />
        )}
      </main>

      <PlaybackControls
        playback={playback}
        onFullscreen={toggleFullscreen}
        stepName={stepName}
        recording={{
          isRecording: recorder.isRecording,
          supported: recorder.supported,
          toggle: toggleRecording,
        }}
      />
    </div>
  );
}
