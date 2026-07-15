import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Stage as StageNode } from "konva/lib/Stage";
import { useFps } from "../anim/useFps";
import { usePlayback } from "../anim/usePlayback";
import { isEditableTarget } from "../editor/isEditableTarget";
import { clearHistory, useEditorStore } from "../store/editorStore";
import { loadPlan } from "../store/persistence";
import { PlaybackControls } from "../viewer/PlaybackControls";
import { ViewerStage } from "../viewer/ViewerStage";

/**
 * `/p/:slug` — read-only playback (plan §3.6). Until the backend lands
 * (Phase 4.6) the only plan is the locally-saved one, so the slug is accepted
 * but not yet resolved against a server.
 */
export function ViewerPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageNode>(null);
  const [loaded, setLoaded] = useState(false);

  const title = useEditorStore((s) => s.title);
  const steps = useEditorStore((s) => s.steps);
  const playback = usePlayback(stageRef);
  // Only measured while something is actually moving (plan §3.7).
  const fps = useFps(playback.isPlaying);

  // Load the saved plan once, before playback builds its first timeline.
  useEffect(() => {
    const saved = loadPlan();
    if (saved) {
      useEditorStore.getState().loadPlan(saved);
      clearHistory();
    }
    setLoaded(true);
  }, []);

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
          {title}
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
        <Link
          to="/plan/local/edit"
          className="ml-auto text-sm text-neutral-400 hover:text-accent"
        >
          Edit
        </Link>
      </header>

      <main className="min-h-0 flex-1">
        {loaded && steps.length === 0 ? (
          <p data-testid="viewer-empty" className="p-8 text-neutral-500">
            This plan has no steps yet. Add some in the editor.
          </p>
        ) : (
          <ViewerStage stageRef={stageRef} />
        )}
      </main>

      <PlaybackControls
        playback={playback}
        onFullscreen={toggleFullscreen}
        stepName={stepName}
      />
    </div>
  );
}
