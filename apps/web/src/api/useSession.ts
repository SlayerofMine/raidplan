import { useCallback, useEffect, useState } from "react";
import { api, isUnauthorized } from "./client";

export interface Session {
  userId: string;
  roles: Record<string, "viewer" | "editor" | "owner">;
}

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "signedIn"; session: Session }
  /** The API couldn't be reached — which is *not* the same as being signed out. */
  | { status: "unreachable" };

/**
 * Who is signed in (plan §10).
 *
 * `me.get` is protected, so UNAUTHORIZED is the *expected* answer for a signed-
 * out visitor. Anything else — the API down, a proxy error, a non-JSON response
 * — is a different situation and must not be reported as "signed out": offering
 * a sign-in button that cannot work is worse than saying what's wrong.
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
        if (isUnauthorized(error)) {
          setState({ status: "anonymous" });
          return;
        }
        // In dev this is nearly always the API not running: `pnpm dev` starts
        // both servers in parallel, and if the API fails to bind the Vite proxy
        // answers with an empty 500 that surfaces as a JSON parse error.
        console.error(
          "Could not reach the RaidPlans API. Is it running on :4000? (`pnpm dev` starts it alongside the web app.)",
          error,
        );
        setState({ status: "unreachable" });
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
