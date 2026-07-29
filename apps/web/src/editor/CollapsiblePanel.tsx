import { useCallback, useState, type ReactNode } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";

/**
 * A titled, collapsible section of the properties sidebar (plan §1.1).
 *
 * The right rail stacks its panels in one scroller, so a plan with a dozen
 * objects pushes Animations below the fold — the panel
 * you are working in is the one you have to scroll to find. Collapsing the ones
 * you aren't using is the cheapest fix: the headers stay put as landmarks, so
 * what is left on screen is still legible as a sidebar rather than a stack of
 * unlabelled controls.
 *
 * Mirrors the Timeline dock's disclosure (same chevron, same `aria-expanded`),
 * because a second idiom for "this opens" would be one too many.
 *
 * **Open state is per panel, and remembered.** Which panels an author keeps shut
 * is a property of how they work, not of the plan, so it lives in localStorage
 * rather than the document — a collapse must never mark a plan dirty or land in
 * an export.
 */
export function CollapsiblePanel({
  id,
  title,
  aside,
  testId,
  className,
  children,
}: {
  /** Stable key for the remembered open state — not the DOM id. */
  id: string;
  title: string;
  /** Optional trailing summary (a count, say) that stays visible when shut. */
  aside?: ReactNode;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id));
  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      writeOpen(id, !wasOpen);
      return !wasOpen;
    });
  }, [id]);

  return (
    <section
      aria-label={title}
      {...(testId ? { "data-testid": testId } : {})}
      data-open={open}
      className={`flex shrink-0 flex-col border-b border-panelborder last:border-b-0 ${
        className ?? ""
      }`}
    >
      <h2 className="shrink-0">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          data-testid={`${id}-toggle`}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-200"
        >
          <span className="text-neutral-500">
            {open ? (
              <LuChevronDown aria-hidden />
            ) : (
              <LuChevronRight aria-hidden />
            )}
          </span>
          {title}
          {aside !== undefined && (
            <span className="ml-auto font-normal normal-case tracking-normal text-neutral-500">
              {aside}
            </span>
          )}
        </button>
      </h2>

      {open && children}
    </section>
  );
}

/**
 * Which panels are shut, under one versioned key.
 *
 * Never throws: storage can be unavailable (private mode, quota) and the blob
 * can be anything a previous version wrote, and neither is worth failing an
 * editor over — the panel just opens, which is the default anyway.
 */
export const PANELS_KEY = "raidplans.panels.v1";

function readOpen(id: string, storage: Storage = localStorage): boolean {
  try {
    const raw = storage.getItem(PANELS_KEY);
    if (!raw) return true;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return true;
    const value = (parsed as Record<string, unknown>)[id];
    return typeof value === "boolean" ? value : true;
  } catch {
    return true;
  }
}

function writeOpen(id: string, open: boolean, storage: Storage = localStorage) {
  try {
    const raw = storage.getItem(PANELS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const state =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    storage.setItem(PANELS_KEY, JSON.stringify({ ...state, [id]: open }));
  } catch {
    // Storage unavailable — the panel still collapses for this session.
  }
}
