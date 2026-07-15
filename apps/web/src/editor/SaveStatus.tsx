import { isLocalPlan } from "./planScope";
import type { RemoteStatus } from "./useRemotePersistence";

/**
 * Where this plan is being saved, and whether that's currently working.
 *
 * Autosave is silent by design, which is fine until it *stops* working — a
 * conflict or a failed save has to be visible, or you keep editing work that
 * is no longer being kept (plan §15).
 */
export function SaveStatus({
  planId,
  remote,
}: {
  planId: string;
  remote: RemoteStatus | null;
}) {
  if (isLocalPlan(planId)) {
    return (
      <span
        data-testid="save-status"
        title="Saved in this browser only. Sign in to save to the server."
        className="text-xs text-neutral-500"
      >
        Offline plan
      </span>
    );
  }
  if (!remote) return null;

  switch (remote.status) {
    case "loading":
      return <Pill testId="save-status">Loading…</Pill>;
    case "saving":
      return <Pill testId="save-status">Saving…</Pill>;
    case "ready":
      return <Pill testId="save-status">Saved</Pill>;
    case "conflict":
      return (
        <Pill testId="save-status" tone="warn">
          {/* Deliberately blunt: we've stopped saving, and why. */}
          Changed elsewhere — reload to keep editing
        </Pill>
      );
    case "error":
      return (
        <Pill testId="save-status" tone="warn" title={remote.message}>
          Not saved
        </Pill>
      );
  }
}

function Pill({
  children,
  tone = "muted",
  testId,
  title,
}: {
  children: React.ReactNode;
  tone?: "muted" | "warn";
  testId: string;
  title?: string;
}) {
  return (
    <span
      data-testid={testId}
      title={title}
      className={`text-xs ${tone === "warn" ? "font-medium text-amber-400" : "text-neutral-500"}`}
    >
      {children}
    </span>
  );
}
