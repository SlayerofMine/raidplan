import { expect, test } from "@playwright/test";

/**
 * The share link (plan §4.6/§4.7). These drive the *SPA*; the API's own
 * behaviour for /p/:slug is covered by apps/api's share route tests, which can
 * assert the Open Graph meta without a browser.
 */
test.describe("viewer routing", () => {
  test("the offline plan plays at /view/local without an account", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("add-step").click();
    await page.waitForTimeout(1400); // let autosave flush

    await page.getByTestId("open-viewer").click();
    await expect(page).toHaveURL(/\/view\/local$/);
    await expect(page.getByTestId("viewer-canvas")).toBeVisible();
  });

  test("an unknown slug says so instead of hanging or crashing", async ({
    page,
  }) => {
    // A slug you may not see is indistinguishable from one that doesn't exist.
    await page.goto("/view/zzzzzzzzzz");
    await expect(page.getByTestId("viewer-missing")).toBeVisible();
    await expect(page.getByTestId("viewer-title")).toContainText("Not found");
  });
});
