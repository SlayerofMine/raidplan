import { useCallback, useRef, useState, type ReactNode } from "react";
import { ToastContext, type Toast, type ToastKind } from "./toastContext";

/**
 * A small toast system (plan §5.4) — the app's one channel for transient
 * feedback, replacing the blocking `window.alert`s that stood in until now.
 *
 * Accessibility matters here (plan §5.3): errors are `role="alert"` +
 * `aria-live="assertive"` so a screen reader announces them immediately;
 * everything else is a polite `status`. Toasts auto-dismiss but are also
 * manually dismissible, and never trap focus.
 *
 * The `useToast` hook lives in `toastContext.ts`.
 */

/** Default lifetime; errors linger a little longer so they aren't missed. */
const DURATIONS: Record<ToastKind, number> = {
  info: 4000,
  success: 4000,
  error: 8000,
};

export function ToastProvider({
  children,
  durations = DURATIONS,
}: {
  children: ReactNode;
  /** Overridable so tests can use short (or zero = sticky) lifetimes. */
  durations?: Record<ToastKind, number>;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++nextId.current;
      setToasts((current) => [...current, { id, message, kind }]);
      const ms = durations[kind];
      if (ms > 0) setTimeout(() => dismiss(id), ms);
    },
    [durations, dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const KIND_CLASS: Record<ToastKind, string> = {
  info: "border-panelborder bg-neutral-800 text-neutral-100",
  success: "border-green-500/40 bg-green-500/10 text-green-200",
  error: "border-amber-500/40 bg-amber-500/10 text-amber-200",
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      data-testid="toast-viewport"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          aria-live={t.kind === "error" ? "assertive" : "polite"}
          data-testid="toast"
          className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded border px-3 py-2 text-sm shadow-lg ${KIND_CLASS[t.kind]}`}
        >
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            className="text-neutral-400 hover:text-neutral-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
