/**
 * The reserved plan id meaning "the offline scratch plan in localStorage".
 *
 * Server plan ids are UUIDs, so `local` can never collide with one. This is what
 * lets the editor work — and keep working — without an account, and it's the
 * plan the viewer falls back to before sharing exists (plan §2.8 vs §4.4).
 */
export const LOCAL_PLAN_ID = "local";

export const isLocalPlan = (planId: string): boolean =>
  planId === LOCAL_PLAN_ID;
