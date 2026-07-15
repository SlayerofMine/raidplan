import { useCallback, useEffect, useState } from "react";
import { api, isUnauthorized } from "./client";

export interface Session {
  userId: string;
  roles: Record<string, "viewer" | "editor" | "owner">;
}

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "signedIn"; session: Session };

/**
 * Who is signed in (plan §10).
 *
 * `me.get` is protected, so UNAUTHORIZED is the *expected* answer for a signed-
 * out visitor, not an error to surface — anything else is a real failure and is
 * logged rather than silently treated as "signed out".
 */
export function useSession(): SessionState & { refresh: () => void } {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.me.get
      .query()
      .then((session) => {
        if (!cancelled) setState({ status: "signedIn", session });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (!isUnauthorized(error)) {
          console.error("Failed to load session", error);
        }
        setState({ status: "anonymous" });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { ...state, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}

/** Where to send someone to sign in, coming back to `next` afterwards. */
export const loginUrl = (next = window.location.pathname) =>
  `/api/login?next=${encodeURIComponent(next)}`;

export const logoutUrl = "/api/logout";
