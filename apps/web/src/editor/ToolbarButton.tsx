import type { ReactNode } from "react";

/** Shared toolbar primitives, so the editor toolbar and the attack designer
 * draw identical controls (plan §2 / §17). */

export function Divider() {
  return <div className="mx-1 h-5 w-px bg-panelborder" />;
}

export function Btn({
  onClick,
  label,
  ariaLabel,
  title,
  disabled,
}: {
  onClick: () => void;
  /** Text, or an icon — an icon label needs `ariaLabel` to carry the name. */
  label: ReactNode;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
      title={title}
      className="inline-flex items-center justify-center rounded border border-panelborder px-2 py-1 text-sm hover:border-accent disabled:opacity-40"
    >
      {label}
    </button>
  );
}
