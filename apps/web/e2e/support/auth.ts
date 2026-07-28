import { expect, type Page } from "@playwright/test";

/**
 * Sign in without Discord, using the API's `DEV_AUTH` backdoor (plan §13).
 *
 * Navigating to `/api/dev/login` sets the session cookie and redirects back to
 * the app, so afterwards `page` is a signed-in session. The default user is on
 * the e2e admin allowlist (see `playwright.auth.config.ts`), so admin-only
 * routes are reachable too.
 */
export async function signIn(
  page: Page,
  userId = "e2e-admin",
  name = "E2E Admin",
): Promise<void> {
  const query = new URLSearchParams({ userId, name, next: "/" });
  await page.goto(`/api/dev/login?${query.toString()}`);
  await page.waitForURL("**/");
}

/**
 * Wait until a server-backed plan has finished loading.
 *
 * The editor mounts, then fetches the document and `loadPlan`s it — which
 * *replaces* whatever is on the store and clears history. Anything a test adds
 * before that lands is silently thrown away, so a spec that starts clicking as
 * soon as the URL changes is racing the fetch and loses it under load.
 *
 * "Saved" is the signal: `SaveStatus` shows "Loading…" until the document is in.
 */
export async function planReady(page: Page): Promise<void> {
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
}
