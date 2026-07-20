import { type Page } from "@playwright/test";

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
