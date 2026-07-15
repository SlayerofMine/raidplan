import { expect, test } from "@playwright/test";

/**
 * The E2E suite runs the built SPA with **no API behind it** — which is also
 * what a developer sees when the API hasn't started (`pnpm dev` runs both in
 * parallel, and the web server comes up regardless). So this doubles as the
 * regression test for that state.
 */
test("home page shows the app title", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /raidplans/i })).toBeVisible();
});

test("says the server is unreachable rather than faking a signed-out state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("api-unreachable")).toBeVisible();
  // Offering a sign-in button that cannot work would be worse than saying so.
  await expect(page.getByTestId("sign-in")).toHaveCount(0);
});

test("the offline plan still works with no server", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /offline editor/i }).click();
  await expect(page).toHaveURL(/\/plan\/local\/edit$/);
  await expect(page.getByTestId("canvas-container")).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("Offline");
});
