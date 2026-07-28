import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import {
  attackNaturalMs,
  layoutStepTimeline,
  type AnimKind,
  type AnimSpan,
  type AttackInstance,
} from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { objectDisplayName } from "../objectName";
import { useContainerSize } from "../canvas/useContainerSize";
import {
  dragValueMs,
  msToPx,
  nudgeValueMs,
  packLanes,
  pxToMs,
  timelineScale,
} from "../../anim/stepTimeline";
import { formatMs, selectPlaybackLocked, usePlayhead } from "./playhead";

/**
 * One slide's Gantt chart (plan §3.4 / §7). Rows are the objects that have an
 * animation on this slide; each animation is a bar whose position and length come
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
/** Height of the scrub ruler — big enough to be a comfortable grab target. */
const RULER_H = 16;
/** How far an Arrow key moves the playhead; Shift makes it ten frames. */
const PLAYHEAD_STEP_MS = 1000 / 60;

/** Tailwind background per animation family, so kinds read at a glance. */
const KIND_BG: Record<AnimKind, string> = {
  entrance: "bg-emerald-500/80",
  exit: "bg-rose-500/80",
  emphasis: "bg-amber-500/80",
  motion: "bg-sky-500/80",
};

export function TimelineChart({ slideIndex }: { slideIndex: number }) {
  const slide = useEditorStore((s) => s.slides[slideIndex]);
  const objects = useEditorStore((s) => s.objects);
  const selectSlide = useEditorStore((s) => s.selectSlide);
  const currentSlideIndex = useEditorStore((s) => s.currentSlideIndex);
  // Retiming a bar while the board is showing a frame of that very animation
  // would fight the playhead, so bars are read-only until the transport stops.
  const locked = usePlayhead(selectPlaybackLocked);
  // Measure a wrapper that is *always* mounted (present in both the empty and
  // populated states), never the track column itself. `useContainerSize` only
  // observes its element on mount, so a track that appears later — the instant
  // you add the first animation to a fresh slide — would never be measured, and
  // every bar would collapse to a zero-width, undraggable stub until reload.
  const [measureRef, measured] = useContainerSize<HTMLDivElement>();

  const slideName = slide?.name ?? `Slide ${slideIndex + 1}`;

  // Layout depends only on the animation list; recompute when it changes.
  const timeline = useMemo(
    () => layoutStepTimeline(slide?.animations ?? []),
    [slide?.animations],
  );

  // Placed attacks get a row each: they occupy the slide from `startMs` for as
  // long as their definition runs — the same `layoutStepTimeline` the player
  // uses, so a bar means the same thing whether it's an animation or an attack.
  const attackDefs = useEditorStore((s) => s.attackDefs);
  const attacks = useEditorStore((s) => s.attacks);
  const attackRows = useMemo(
    () =>
      // Attacks live on the plan; a slide's chart shows the ones it fires.
      attacks
        .filter((instance) => instance.slideId === slide?.id)
        .map((instance) => {
          const def = attackDefs[instance.attackId];
          const naturalMs = def ? attackNaturalMs(def) : 0;
          return {
            instance,
            name: instance.name?.trim() || def?.name || "Attack",
            naturalMs,
            spanMs: instance.durationMs ?? naturalMs,
          };
        }),
    [attacks, slide?.id, attackDefs],
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

  if (!slide) return null;

  const active = currentSlideIndex === slideIndex;
  // The track column is the measured width minus the fixed label column (there
  // is no column gap), so the scale is known even before the first row exists.
  const trackWidth = Math.max(0, measured.width - LABEL_W);
  // An attack can outlast the slide's own animations, so the ruler has to cover
  // it or its bar would run off the end.
  const contentMs = attackRows.reduce(
    (longest, row) => Math.max(longest, row.instance.startMs + row.spanMs),
    timeline.totalMs,
  );
  const scale = timelineScale(trackWidth, contentMs);

  return (
    <section
      aria-label={`Timeline: ${slideName}`}
      data-testid={`timeline-slide-${slideIndex}`}
      className={`rounded border px-2 py-1.5 ${
        active ? "border-accent/70" : "border-panelborder"
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={() => selectSlide(slideIndex)}
          className={`truncate text-xs font-semibold ${
            active ? "text-accent" : "text-neutral-300 hover:text-neutral-100"
          }`}
          title="Edit this slide"
        >
          {slideName}
        </button>
        <span className="shrink-0 text-[10px] tabular-nums text-neutral-500">
          {Math.round(timeline.totalMs)}ms
        </span>
      </div>

      {/* Always mounted, so its width is known before any row appears. It is
          also the playhead's frame of reference: the marker is drawn over the
          whole stack of rows, not inside any one of them. */}
      <div
        ref={measureRef}
        data-testid={`timeline-track-${slideIndex}`}
        className="relative"
      >
        {/* Only the slide being edited has a playhead — it is the only one the
            canvas can be showing a frame of. */}
        {active && <Playhead pxPerMs={scale.pxPerMs} />}
        {rows.length === 0 && attackRows.length === 0 ? (
          <p
            data-testid={`timeline-empty-${slideIndex}`}
            className="py-1 text-xs text-neutral-600"
          >
            No animations on this slide.
          </p>
        ) : (
          <div
            className="grid gap-y-1"
            style={{ gridTemplateColumns: `${LABEL_W}px 1fr` }}
          >
            {/* Ruler: an empty label cell plus the track column. */}
            <div />
            <Ruler
              contentMs={scale.contentMs}
              pxPerMs={scale.pxPerMs}
              active={active}
            />

            {rows.map((objectId) => {
              const spans = timeline.spans.filter(
                (s) => s.objectId === objectId,
              );
              return (
                <ObjectRow
                  key={objectId}
                  slideIndex={slideIndex}
                  objectId={objectId}
                  label={objectDisplayName(objects[objectId])}
                  spans={spans}
                  pxPerMs={scale.pxPerMs}
                  locked={locked}
                />
              );
            })}

            {attackRows.map((row) => (
              <AttackRow
                key={row.instance.id}
                instance={row.instance}
                name={row.name}
                spanMs={row.spanMs}
                naturalMs={row.naturalMs}
                pxPerMs={scale.pxPerMs}
                locked={locked}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The scrub ruler — the strip you drag to move the playhead, like the time
 * ruler above a video editor's tracks.
 *
 * A `slider`, not a bare div: that gives it Arrow-key scrubbing and a spoken
 * position for free, and — since jsdom measures nothing and `pxPerMs` is 0
 * there — keyboard scrubbing is also the part that can be tested without a
 * layout engine, exactly as bar dragging already is.
 *
 * Pointer positions are read against the strip's own box rather than tracked as
 * a delta, so a drag that runs off either end pins to 0 or to the slide's length
 * instead of drifting.
 *
 * The scrub *range* comes from the playhead store, not from this chart's own
 * `totalMs`. They are the same number — both are `layoutStepTimeline` on the
 * same slide — but only one of them can be the one `seekMs` clamps against, and
 * a slider whose maximum and whose clamp are computed in two places is a slider
 * that will one day stop at the wrong end.
 */
function Ruler({
  contentMs,
  pxPerMs,
  active,
}: {
  /** The span the ruler is drawn against — never shorter than the minimum. */
  contentMs: number;
  pxPerMs: number;
  active: boolean;
}) {
  const timeMs = usePlayhead((s) => s.timeMs);
  const durationMs = usePlayhead((s) => s.durationMs);
  const seekMs = usePlayhead((s) => s.seekMs);

  // Scrubbing an off-screen slide would move a playhead that isn't shown.
  const scrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || pxPerMs <= 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    seekMs(pxToMs(e.clientX - box.left, pxPerMs));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir) {
      e.preventDefault();
      seekMs(timeMs + dir * PLAYHEAD_STEP_MS * (e.shiftKey ? 10 : 1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      seekMs(0);
    } else if (e.key === "End") {
      e.preventDefault();
      seekMs(durationMs);
    }
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Playhead"
      data-testid="timeline-ruler"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs)}
      aria-valuenow={Math.round(timeMs)}
      aria-valuetext={formatMs(timeMs)}
      title="Drag to scrub through this slide"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        scrub(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e);
      }}
      onKeyDown={onKeyDown}
      className="relative cursor-ew-resize touch-none border-b border-panelborder focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
      style={{ height: RULER_H }}
    >
      <span className="pointer-events-none absolute left-0 top-0 text-[10px] text-neutral-600">
        0
      </span>
      <span className="pointer-events-none absolute right-0 top-0 text-[10px] text-neutral-600">
        {Math.round(contentMs)}ms
      </span>
    </div>
  );
}

/**
 * The playhead marker: one line down the whole chart at the time the canvas is
 * currently showing, with a grab head sitting in the ruler.
 *
 * Its own component so that the 60 fps `timeMs` subscription lands *here* and
 * nowhere else — re-rendering a two-element marker each frame is nothing, while
 * re-rendering the chart (and its bars, and their drag handlers) would not be.
 */
function Playhead({ pxPerMs }: { pxPerMs: number }) {
  const timeMs = usePlayhead((s) => s.timeMs);
  // A slide with nothing to play has no moment to point at.
  const durationMs = usePlayhead((s) => s.durationMs);
  if (durationMs <= 0) return null;

  return (
    <div
      data-testid="timeline-playhead"
      data-time-ms={Math.round(timeMs)}
      aria-hidden="true"
      // Near-white rather than the accent: the playhead has to read on top of
      // whatever bar it crosses, and the accent is a blue that disappears into
      // a `motion` bar — the one kind it will cross most often.
      className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-neutral-100"
      style={{ left: LABEL_W + msToPx(timeMs, pxPerMs) }}
    >
      {/* A downward triangle, so the head reads as a grip in the ruler. */}
      <span className="absolute -left-[3px] top-0 border-x-[3px] border-t-[5px] border-x-transparent border-t-neutral-100" />
    </div>
  );
}

/**
 * A placed attack's bar, with the same two grips every animation bar has:
 *
 *  - the **body** moves the whole attack within the slide (`startMs`);
 *  - the **handle** stretches it in time — the attack still plays exactly as
 *    authored, just slower or faster, because the whole bundle is scaled rather
 *    than re-timed part by part.
 *
 * Until the handle is touched an attack has no duration of its own and follows
 * its definition's, so improving the definition still reaches this plan.
 */
function AttackRow({
  instance,
  name,
  spanMs,
  naturalMs,
  pxPerMs,
  locked,
}: {
  instance: AttackInstance;
  name: string;
  /** How long it runs here — stretched if this plan said so. */
  spanMs: number;
  /** How long the definition runs on its own. */
  naturalMs: number;
  pxPerMs: number;
  /** The playhead is off zero: show the bar, but don't let it be retimed. */
  locked: boolean;
}) {
  const updateAttack = useEditorStore((s) => s.updateAttack);
  const selectAttack = useEditorStore((s) => s.selectAttack);
  const selected = useEditorStore((s) =>
    s.selectedAttackIds.includes(instance.id),
  );

  const setStart = (startMs: number) => updateAttack(instance.id, { startMs });
  const setDuration = (durationMs: number) =>
    updateAttack(instance.id, { durationMs });

  const stretched = instance.durationMs !== undefined && naturalMs > 0;
  const speed = stretched ? naturalMs / spanMs : 1;
  const describe =
    `${name} · starts ${Math.round(instance.startMs)}ms · ${Math.round(spanMs)}ms` +
    (stretched ? ` · ${speed.toFixed(2)}× speed` : "");

  const beginDrag = (
    e: ReactPointerEvent,
    from: number,
    min: number,
    apply: (ms: number) => void,
  ) => {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const move = (ev: PointerEvent) =>
      apply(dragValueMs(from, ev.clientX - startX, pxPerMs, min));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => selectAttack([instance.id])}
        data-testid={`timeline-attack-row-${instance.id}`}
        className="min-w-0 truncate pr-2 text-right text-xs text-neutral-300 hover:text-accent"
        title={`Select ${name}`}
        style={{ height: LANE_H }}
      >
        {name}
      </button>
      <div className="relative" style={{ height: LANE_H }}>
        <button
          type="button"
          data-testid={`timeline-attack-${instance.id}`}
          aria-label={describe}
          title={describe}
          onPointerDown={(e) => beginDrag(e, instance.startMs, 0, setStart)}
          onClick={() => selectAttack([instance.id])}
          onKeyDown={(e) => {
            const dir =
              e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!dir || locked) return;
            e.preventDefault();
            setStart(
              nudgeValueMs(instance.startMs, dir * (e.shiftKey ? 5 : 1)),
            );
          }}
          className={`absolute flex h-full min-w-[6px] items-center overflow-hidden rounded-sm bg-violet-500/80 text-[10px] text-black/80 ${
            selected ? "ring-1 ring-inset ring-white/70" : ""
          }`}
          style={{
            left: msToPx(instance.startMs, pxPerMs),
            width: Math.max(msToPx(spanMs, pxPerMs), 6),
          }}
        >
          <span className="pointer-events-none truncate px-1">{name}</span>
          {/* Handle: stretch the whole attack in time. */}
          <span
            role="button"
            tabIndex={0}
            data-testid={`timeline-attack-handle-${instance.id}`}
            aria-label={`Stretch ${name}`}
            title="Drag to make the whole attack run slower or faster"
            onPointerDown={(e) =>
              beginDrag(e, spanMs, DURATION_MIN_MS, setDuration)
            }
            onKeyDown={(e) => {
              const dir =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!dir || locked) return;
              e.preventDefault();
              e.stopPropagation();
              setDuration(
                nudgeValueMs(
                  spanMs,
                  dir * (e.shiftKey ? 5 : 1),
                  DURATION_MIN_MS,
                ),
              );
            }}
            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30 hover:bg-black/50"
          />
        </button>
      </div>
    </>
  );
}

function ObjectRow({
  slideIndex,
  objectId,
  label,
  spans,
  pxPerMs,
  locked,
}: {
  slideIndex: number;
  objectId: string;
  label: string;
  spans: AnimSpan[];
  pxPerMs: number;
  locked: boolean;
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
            slideIndex={slideIndex}
            span={span}
            pxPerMs={pxPerMs}
            top={(lane.get(span.animId) ?? 0) * (LANE_H + LANE_GAP)}
            locked={locked}
          />
        ))}
      </div>
    </>
  );
}

function Bar({
  slideIndex,
  span,
  pxPerMs,
  top,
  locked,
}: {
  slideIndex: number;
  span: AnimSpan;
  pxPerMs: number;
  top: number;
  locked: boolean;
}) {
  const updateAnimation = useEditorStore((s) => s.updateAnimation);
  const select = useEditorStore((s) => s.select);

  const setDelay = (delayMs: number) =>
    updateAnimation(slideIndex, span.animId, { delayMs });
  const setDuration = (durationMs: number) =>
    updateAnimation(slideIndex, span.animId, { durationMs });

  const delayW = msToPx(span.delayMs, pxPerMs);
  const bodyW = msToPx(span.spanMs, pxPerMs);
  const left = msToPx(span.triggerMs, pxPerMs);

  // Deferred bars sit on the timeline for reference only — they fire on a click
  // or a collision, so say which rather than implying a time.
  const deferredNote =
    span.trigger === "onClick"
      ? " · on click"
      : span.trigger === "onCollision"
        ? " · on collision"
        : "";
  const describe =
    `${span.effect} (${span.kind}) · delay ${Math.round(span.delayMs)}ms · ` +
    `${Math.round(span.durationMs)}ms${deferredNote}`;

  // Drag helper: attach window listeners so the pointer keeps controlling the
  // value even if it leaves the bar. `start` is captured at press, so re-renders
  // mid-drag never corrupt the value.
  const beginDrag = (
    e: ReactPointerEvent,
    start: number,
    min: number,
    commit: (ms: number) => void,
  ) => {
    if (locked) return;
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
    locked ? 0 : e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;

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
        } ${span.deferred ? "opacity-60 ring-1 ring-inset ring-white/40" : ""}`}
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
