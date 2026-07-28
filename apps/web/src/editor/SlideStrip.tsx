import type { ReactNode } from "react";
import {
  LuArrowRightToLine,
  LuChevronLeft,
  LuChevronRight,
  LuCopy,
  LuPlus,
  LuX,
} from "react-icons/lu";
import { useEditorStore } from "../store/editorStore";

/**
 * The slides strip (plan §3.2) — the plan's slides, in order.
 *
 * Every entry is a slide and nothing else. There used to be a `Base` chip in
 * front of them for "the starting layout", which was neither a slide nor
 * plainly not one; slide 1 is the opening layout now, so the distinction — and
 * the question of which of the two an edit was about to land in — is gone.
 *
 * Selecting a slide means edits land in *that slide's* layout, and in no other
 * (plan §5). A slide owns its cast too, so the three ways to make one are
 * genuinely different things to say: **+ Slide** is an empty stage, **Continue**
 * keeps the objects where the previous slide left them (what a `move` needs — it
 * animates one object across two slides), and **Duplicate** copies what happens
 * as well.
 */
export function SlideStrip() {
  const slides = useEditorStore((s) => s.slides);
  const currentSlideIndex = useEditorStore((s) => s.currentSlideIndex);
  const selectSlide = useEditorStore((s) => s.selectSlide);
  const addSlide = useEditorStore((s) => s.addSlide);
  const continueSlide = useEditorStore((s) => s.continueSlide);
  const duplicateSlide = useEditorStore((s) => s.duplicateSlide);
  const deleteSlide = useEditorStore((s) => s.deleteSlide);
  const moveSlide = useEditorStore((s) => s.moveSlide);

  // The last slide can't be deleted — a plan is its slides.
  const canDelete = slides.length > 1;

  return (
    <footer
      aria-label="Slides"
      className="flex items-center gap-2 overflow-x-auto border-t border-panelborder bg-panel px-3 py-2"
    >
      {slides.map((slide, index) => {
        const active = index === currentSlideIndex;
        return (
          <div
            key={slide.id}
            className={`flex items-center gap-1 rounded border px-1 ${
              active ? "border-accent" : "border-panelborder"
            }`}
          >
            <button
              type="button"
              onClick={() => selectSlide(index)}
              aria-pressed={active}
              data-testid={`slide-${index}`}
              className={chip(active)}
            >
              {slide.name ?? `Slide ${index + 1}`}
              {slide.animations.length > 0 && (
                <span className="ml-1 text-xs text-neutral-500">
                  ({slide.animations.length})
                </span>
              )}
            </button>
            <IconBtn
              label={`Move ${slide.name ?? `Slide ${index + 1}`} earlier`}
              icon={<LuChevronLeft aria-hidden />}
              disabled={index === 0}
              onClick={() => moveSlide(index, index - 1)}
            />
            <IconBtn
              label={`Move ${slide.name ?? `Slide ${index + 1}`} later`}
              icon={<LuChevronRight aria-hidden />}
              disabled={index === slides.length - 1}
              onClick={() => moveSlide(index, index + 1)}
            />
            <IconBtn
              label={`Continue from ${slide.name ?? `Slide ${index + 1}`}`}
              title={`New slide with the same objects where ${
                slide.name ?? `Slide ${index + 1}`
              } leaves them`}
              testId={`continue-slide-${index}`}
              icon={<LuArrowRightToLine aria-hidden />}
              onClick={() => continueSlide(index)}
            />
            <IconBtn
              label={`Duplicate ${slide.name ?? `Slide ${index + 1}`}`}
              title={`Copy ${
                slide.name ?? `Slide ${index + 1}`
              } — its objects and what happens on it`}
              icon={<LuCopy aria-hidden />}
              onClick={() => duplicateSlide(index)}
            />
            <IconBtn
              label={`Delete ${slide.name ?? `Slide ${index + 1}`}`}
              icon={<LuX aria-hidden />}
              disabled={!canDelete}
              onClick={() => deleteSlide(index)}
            />
          </div>
        );
      })}

      <button
        type="button"
        onClick={addSlide}
        data-testid="add-slide"
        title="New empty slide — use Continue on a slide to carry its objects forward"
        className="flex items-center gap-1 rounded border border-panelborder px-2 py-1 text-sm hover:border-accent"
      >
        <LuPlus aria-hidden />
        Slide
      </button>

      <span
        className="ml-auto text-sm text-neutral-500"
        data-testid="editing-slide"
      >
        Editing:{" "}
        {slides[currentSlideIndex]?.name ?? `Slide ${currentSlideIndex + 1}`}
      </span>
    </footer>
  );
}

const chip = (active: boolean) =>
  `whitespace-nowrap rounded px-2 py-1 text-sm ${
    active ? "text-accent" : "text-neutral-300 hover:text-neutral-100"
  }`;

function IconBtn({
  label,
  title,
  testId,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  /** Hover text, where the accessible name is too terse to explain the button. */
  title?: string;
  testId?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      {...(testId ? { "data-testid": testId } : {})}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center px-1 text-sm text-neutral-500 hover:text-accent disabled:opacity-30"
    >
      {icon}
    </button>
  );
}
