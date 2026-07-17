import { createContext, useContext } from "react";

/**
 * The toast context and its hook, split out from the provider component so each
 * file has a single kind of export (keeps React Fast Refresh happy) — see
 * `toast.tsx` for the provider and viewport.
 */
export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/** Access the toast API. Throws if used outside a provider — a wiring bug. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used within a ToastProvider");
  return api;
}
