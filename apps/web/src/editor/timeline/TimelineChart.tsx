import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import type { AnimKind } from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { objectDisplayName } from "../objectName";
import { useContainerSize } from "../canvas/useContainerSize";
import {
  dragValueMs,
  layoutStepTimeline,
  msToPx,
  nudgeValueMs,
  packLanes,
  timelineScale,
  type AnimSpan,
} from "../../anim/stepTimeline";

/**
 * One step's Gantt chart (plan §3.4 / §7). Rows are the objects that have an
 * animation on this step; each animation is a bar whose position and length come
 * from the shared {@link layoutStepTimeline} — the *same* math the player runs,
 * so a bar sits exactly where the frame will.
 *
 * A bar has two grabbable parts:
 *  - the **body** — drag it (or Arrow keys) to change `delayMs`;
 *  - the **right handle** — drag it (or Arrow keys) to change `durationMs`.
 *
 * Keyboard editing needs no pixel scale, which keeps the whole chart operable
 * without a mouse (plan §5.3 a11y) and testable in jsdom.
 */

const LABEL_W = 104;
const LANE_H = 22;
const LANE_GAP = 3;
const BODY_MIN_MS = 0;
const DURATION_MIN_MS = 50;

/** Tailwind background per animation family, so kinds read at a glance. */
const KIND_BG: Record<AnimKind, string> = {
  entrance: "bg-emerald-500/80",
  exit: "bg-rose-500/80",
  emphasis: "bg-amber-500/80",
  motion: "bg-sky-500/80",
};

export function TimelineChart({ stepIndex }: { stepIndex: number }) {
  const step = useEditorStore((s) => s.steps[stepIndex]);
  const objects = useEditorStore((s) => s.objects);
  const selectStep = useEditorStore((s) => s.selectStep);
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex);
  // Measure a wrapper that is *always* mounted (present in both the empty and
  // populated states), never the track column itself. `useContainerSize` only
  // observes its element on mount, so a track that appears later — the instant
  // you add the first animation to a fresh step — would never be measured, and
  // every bar would collapse to a zero-width, undraggable stub until reload.
  const [measureRef, measured] = useContainerSize<HTMLDivElement>();

  const stepName = step?.name ?? `Step ${stepIndex + 1}`;

  // Layout depends only on the animation list; recompute when it changes.
  const timeline = useMemo(
    () => layoutStepTimeline(step?.animations ?? []),
    [step?.animations],
  );

  // Object rows in first-appearance order, so the chart reads top-to-bottom the
  // way the animation list does.
  const rows = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const span of timeline.spans) {
      if (!seen.has(span.objectId)) {
        seen.add(span.objectId);
        order.push(span.objectId);
      }
    }
    return order;
  }, [timeline]);

  if (!step) return null;

  const active = currentStepIndex === stepIndex;
  // The track column is the measured width minus the fixed label column (there
  // is no column gap), so the scale is known even before the first row exists.
  const trackWidth = Math.max(0, measured.width - LABEL_W);
  const scale = timelineScale(trackWidth, timeline.totalMs);

  return (
    <section
      aria-label={`Timeline: ${stepName}`}
      data-testid={`timeline-step-${stepIndex}`}
      className={`rounded border px-2 py-1.5 ${
        active ? "border-accent/70" : "border-panelborder"
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={() => selectStep(stepIndex)}
          className={`truncate text-xs font-semibold ${
            active ? "text-accent" : "text-neutral-300 hover:text-neutral-100"
          }`}
          title="Edit this step"
        >
          {stepName}
        </button>
        <span className="shrink-0 text-[10px] tabular-nums text-neutral-500">
          {Math.round(timeline.totalMs)}ms
        </span>
      </div>

      {/* Always mounted, so its width is known before any row appears. */}
      <div ref={measureRef} data-testid={`timeline-track-${stepIndex}`}>
        {rows.length === 0 ? (
          <p
            data-testid={`timeline-empty-${stepIndex}`}
            className="py-1 text-xs text-neutral-600"
          >
            No animations on this step.
          </p>
        ) : (
          <div
            className="grid gap-y-1"
            style={{ gridTemplateColumns: `${LABEL_W}px 1fr` }}
          >
            {/* Ruler: an empty label cell plus the track column. */}
            <div />
            <div className="relative h-3">
              <span className="absolute left-0 top-0 text-[10px] text-neutral-600">
                0
              </span>
              <span className="absolute right-0 top-0 text-[10px] text-neutral-600">
                {Math.round(scale.contentMs)}ms
              </span>
            </div>

            {rows.map((objectId) => {
              const spans = timeline.spans.filter(
                (s) => s.objectId === objectId,
              );
              return (
                <ObjectRow
                  key={objectId}
                  stepIndex={stepIndex}
                  objectId={objectId}
                  label={objectDisplayName(objects[objectId])}
                  spans={spans}
                  pxPerMs={scale.pxPerMs}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function ObjectRow({
  stepIndex,
  objectId,
  label,
  spans,
  pxPerMs,
}: {
  stepIndex: number;
  objectId: string;
  label: string;
  spans: AnimSpan[];
  pxPerMs: number;
}) {
  const select = useEditorStore((s) => s.select);

  // Concurrent animations on one object (e.g. move + fade `withPrevious`) get
  // their own lane so they never draw on top of each other; sequential ones
  // share a lane to keep the row compact.
  const { lane, laneCount } = packLanes(spans);

  return (
    <>
      <button
        type="button"
        onClick={() => select([objectId])}
        data-testid={`timeline-row-${objectId}`}
        className="min-w-0 truncate pr-2 text-right text-xs text-neutral-300 hover:text-accent"
        title={`Select ${label}`}
        style={{ height: LANE_H }}
      >
        {label}
      </button>
      <div
        className="relative"
        style={{ height: laneCount * (LANE_H + LANE_GAP) - LANE_GAP }}
      >
        {spans.map((span) => (
          <Bar
            key={span.animId}
            stepIndex={stepIndex}
            span={span}
            pxPerMs={pxPerMs}
            top={(lane.get(span.animId) ?? 0) * (LANE_H + LANE_GAP)}
          />
        ))}
      </div>
    </>
  );
}

function Bar({
  stepIndex,
  span,
  pxPerMs,
  top,
}: {
  stepIndex: number;
  span: AnimSpan;
  pxPerMs: number;
  top: number;
}) {
  const updateAnimation = useEditorStore((s) => s.updateAnimation);
  const select = useEditorStore((s) => s.select);

  const setDelay = (delayMs: number) =>
    updateAnimation(stepIndex, span.animId, { delayMs });
  const setDuration = (durationMs: number) =>
    updateAnimation(stepIndex, span.animId, { durationMs });

  const delayW = msToPx(span.delayMs, pxPerMs);
  const bodyW = msToPx(span.spanMs, pxPerMs);
  const left = msToPx(span.triggerMs, pxPerMs);

  const describe =
    `${span.effect} (${span.kind}) · delay ${Math.round(span.delayMs)}ms · ` +
    `${Math.round(span.durationMs)}ms` +
    (span.clickTriggered ? " · on click" : "");

  // Drag helper: attach window listeners so the pointer keeps controlling the
  // value even if it leaves the bar. `start` is captured at press, so re-renders
  // mid-drag never corrupt the value.
  const beginDrag = (
    e: ReactPointerEvent,
    start: number,
    min: number,
    commit: (ms: number) => void,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const move = (ev: PointerEvent) =>
      commit(dragValueMs(start, ev.clientX - startX, pxPerMs, min));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const keyStep = (e: React.KeyboardEvent) =>
    e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;

  return (
    <div
      className="absolute flex items-center"
      style={{ left, top, height: LANE_H }}
    >
      {/* Delay: a faint dashed lead-in from the trigger anchor to the start. */}
      {span.delayMs > 0 && (
        <span
          aria-hidden="true"
          data-testid={`timeline-delay-${span.animId}`}
          className="h-1 border-t border-dashed border-neutral-500"
          style={{ width: delayW }}
        />
      )}

      {/* Body: drag / Arrow keys change the delay. */}
      <button
        type="button"
        data-testid={`timeline-bar-${span.animId}`}
        aria-label={describe}
        title={describe}
        onPointerDown={(e) => beginDrag(e, span.delayMs, BODY_MIN_MS, setDelay)}
        onClick={() => select([span.objectId])}
        onKeyDown={(e) => {
          const dir = keyStep(e);
          if (!dir) return;
          e.preventDefault();
          setDelay(nudgeValueMs(span.delayMs, dir * (e.shiftKey ? 5 : 1)));
        }}
        className={`relative flex h-full min-w-[6px] items-center overflow-hidden rounded-sm text-[10px] text-black/80 ${
          KIND_BG[span.kind]
        } ${span.clickTriggered ? "opacity-60 ring-1 ring-inset ring-white/40" : ""}`}
        style={{ width: Math.max(bodyW, 6) }}
      >
        <span className="pointer-events-none truncate px-1">{span.effect}</span>
        {/* Handle: drag / Arrow keys change the duration. */}
        <span
          role="button"
          tabIndex={0}
          data-testid={`timeline-handle-${span.animId}`}
          aria-label={`Resize duration of ${span.effect}`}
          title="Drag to change duration"
          onPointerDown={(e) =>
            beginDrag(e, span.durationMs, DURATION_MIN_MS, setDuration)
          }
          onKeyDown={(e) => {
            const dir = keyStep(e);
            if (!dir) return;
            e.preventDefault();
            e.stopPropagation();
            setDuration(
              nudgeValueMs(
                span.durationMs,
                dir * (e.shiftKey ? 5 : 1),
                DURATION_MIN_MS,
              ),
            );
          }}
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30 hover:bg-black/50"
        />
      </button>
    </div>
  );
}
