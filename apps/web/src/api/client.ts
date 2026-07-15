import {
  createTRPCClient,
  httpBatchLink,
  TRPCClientError,
  type TRPCClient,
} from "@trpc/client";
import type { AppRouter } from "@raidplan/api/trpc";

/**
 * The API client (plan §9). `AppRouter` is imported **as a type only**, so no
 * server code reaches the bundle — but every call, argument and result is
 * checked against the real router. Rename a procedure in `apps/api` and this
 * app stops compiling, which is the whole point of the shared contract.
 *
 * Requests go to a relative path: Caddy serves the SPA and proxies /trpc to the
 * API from one origin in production, and the Vite dev proxy mirrors that. Same
 * origin means the session cookie just travels — no CORS, no token juggling.
 */
// The explicit annotation is required: the inferred type reaches into the API
// package's internals, which TypeScript can't name portably from here (TS2742).
export const api: TRPCClient<AppRouter> = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/trpc",
      // Without this the session cookie isn't attached and every call is
      // anonymous.
      fetch: (url, options) =>
        fetch(url, { ...options, credentials: "include" }),
    }),
  ],
});

/** The tRPC error code for a failed call, if it is one. */
export function errorCode(error: unknown): string | undefined {
  if (error instanceof TRPCClientError) {
    return (error.data as { code?: string } | undefined)?.code;
  }
  return undefined;
}

/** True when a save lost a race with a newer one (plan §15). */
export const isConflict = (error: unknown) => errorCode(error) === "CONFLICT";

/** True when the caller isn't signed in. */
export const isUnauthorized = (error: unknown) =>
  errorCode(error) === "UNAUTHORIZED";
