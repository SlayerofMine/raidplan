import { useEffect, useMemo } from "react";
import gsap from "gsap";
import { layoutStepTimeline } from "@raidplan/shared";
import { createSlideScrubber } from "../../anim/slideScrubber";
import { useEditorStore } from "../../store/editorStore";
import { getStageNode } from "../canvas/stageHandle";
import { usePlayhead } from "./playhead";

/**
 * Drives the editor's playhead: turns {@link usePlayhead}'s `timeMs` into
 * pixels on the editor canvas, and advances it while the transport runs.
 *
 * Mounted once, by the editor shell. Two jobs, deliberately split:
 *
 *  - **Advance.** A `gsap.ticker` listener — added only while playing, so an
 *    idle editor runs no frame loop at all — moves `timeMs` on at `speed`, and
 *    at the end either wraps (loop) or stops.
 *  - **Apply.** A plain store *subscription*, not a React render. Every frame
 *    goes straight from `timeMs` to `SlideScrubber.seek`, which writes the Konva
 *    nodes and redraws. React never sees a frame (plan §8.1) — which is the only
 *    reason a 60 fps playhead can coexist with an editor canvas whose nodes are
 *    otherwise React-owned.
 *
 * **Time 0 is special.** It restores rather than seeks: `seek(0)` produces the
 * slide's *animation* start — a fade-in sits at opacity 0 there — whereas at
 * rest the editor must show the layout as stored, which is what you are editing.
 * That restore is also the handover back to React: it puts every node back to
 * exactly the values `ObjectNode` last rendered, so the two never disagree about
 * who owns the board.
 */
export function useEditorPlayhead(): void {
  const slides = useEditorStore((s) => s.slides);
  const objects = useEditorStore((s) => s.objects);
  const objectIds = useEditorStore((s) => s.objectIds);
  const slideIndex = useEditorStore((s) => s.currentSlideIndex);
  // Coarse: a handful of changes per session, never per frame.
  const isPlaying = usePlayhead((s) => s.isPlaying);

  const durationMs = useMemo(
    () => layoutStepTimeline(slides[slideIndex]?.animations ?? []).totalMs,
    [slides, slideIndex],
  );

  // Retiming a bar shortens the slide under the playhead; the store clamps.
  useEffect(() => {
    usePlayhead.getState().setDurationMs(durationMs);
  }, [durationMs]);

  // Apply. Rebuilt whenever the document or the slide changes, because the
  // compiled timelines are cut from exactly that.
  useEffect(() => {
    const stage = getStageNode();
    if (!stage) return;
    const scrubber = createSlideScrubber({
      stage,
      slides,
      objects,
      objectIds,
    });

    /**
     * Has the scrubber written anything? While it hasn't, the nodes are still
     * React's own output and time 0 needs no restoring — which keeps an editor
     * nobody has pressed play in from touching Konva on every edit.
     */
    let scrubbed = false;

    const render = (timeMs: number) => {
      if (timeMs > 0) {
        scrubbed = scrubber.seek(slideIndex, timeMs) || scrubbed;
      } else if (scrubbed) {
        scrubber.restore(slideIndex);
        scrubbed = false;
      }
    };

    render(usePlayhead.getState().timeMs);
    const unsubscribe = usePlayhead.subscribe((s, previous) => {
      if (s.timeMs !== previous.timeMs) render(s.timeMs);
    });

    return () => {
      unsubscribe();
      // Hand the board back to React before the next build takes over. The
      // slide index is read fresh: on a slide change this cleanup runs *after*
      // the new props are on the nodes, so restoring the closed-over old slide
      // would undo them.
      if (scrubbed) {
        scrubber.restore(useEditorStore.getState().currentSlideIndex);
      }
    };
  }, [slides, objects, objectIds, slideIndex]);

  // Advance.
  useEffect(() => {
    if (!isPlaying) return;
    const tick = () => {
      const s = usePlayhead.getState();
      if (s.durationMs <= 0) {
        s.stop();
        return;
      }
      const next = s.timeMs + gsap.ticker.deltaRatio() * (1000 / 60) * s.speed;
      if (next < s.durationMs) {
        s.seekMs(next);
      } else if (s.loop) {
        // Carry the overshoot across the wrap, so looping doesn't drift slow.
        s.seekMs(next % s.durationMs);
      } else {
        s.seekMs(s.durationMs);
        s.pause();
      }
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [isPlaying]);

  // Leaving the editor must never strand the lock on for the next mount.
  useEffect(() => () => usePlayhead.getState().stop(), []);
}
