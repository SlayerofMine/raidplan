import { useEditorStore } from "../store/editorStore";

/**
 * What to do with an empty slide that isn't the first one (plan §3.2).
 *
 * Slides own their objects, so a new one starts empty — which is right, and is
 * also a dead end if you came here to animate something: a `move` carries one
 * object from the previous slide's layout to this one, so it needs that object
 * to be *in* both scenes, and an empty slide has nothing to move. Before slides
 * were independent, adding one copied the previous layout and this question
 * never came up.
 *
 * So the empty state answers it, rather than leaving a blank board and a
 * greyed-out "Animate" button to be interpreted. Only on an empty, non-opening
 * slide: on slide 1 an empty board is just a new plan, and once anything is
 * here the author has clearly said what they meant.
 */
export function EmptySlideHint() {
  const isEmptyLaterSlide = useEditorStore(
    (s) =>
      s.currentSlideIndex > 0 &&
      Object.keys(s.slides[s.currentSlideIndex]?.states ?? {}).length === 0,
  );
  const carryOverInto = useEditorStore((s) => s.carryOverInto);
  const index = useEditorStore((s) => s.currentSlideIndex);

  if (!isEmptyLaterSlide) return null;

  return (
    <div
      data-testid="empty-slide-hint"
      className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center"
    >
      <div className="pointer-events-auto max-w-md rounded border border-panelborder bg-panel/95 px-4 py-3 text-center text-sm text-neutral-300 shadow-lg">
        <p>
          This slide is empty. Drop something in from the palette, or carry the
          previous slide&apos;s objects over — which is what a{" "}
          <strong className="text-neutral-100">move</strong> animates between.
        </p>
        <div className="mt-2 flex justify-center gap-2">
          <button
            type="button"
            data-testid="empty-slide-continue"
            onClick={() => carryOverInto(index)}
            className="rounded border border-accent px-3 py-1 text-neutral-100 hover:bg-accent/10"
          >
            Continue from the previous slide
          </button>
        </div>
      </div>
    </div>
  );
}
