import { expect, test } from "@playwright/test";

test("home page shows the app title", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /raidplans/i })).toBeVisible();
});
