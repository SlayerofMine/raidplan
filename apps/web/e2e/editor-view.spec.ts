import { expect, test } from "@playwright/test";

test.describe("view controls", () => {
  test("zoom buttons change the zoom level and Fit restores it", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    const zoom = page.getByTestId("zoom-level");

    // Establish a known baseline (fit-to-stage).
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const fit = (await zoom.textContent())!;

    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoom).not.toHaveText(fit);

    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(zoom).toHaveText(fit);
  });

  test("wheeling over the canvas zooms", async ({ page }) => {
    await page.goto("/plan/local/edit");
    const zoom = page.getByTestId("zoom-level");
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const fit = (await zoom.textContent())!;

    const box = await page.getByTestId("canvas-container").boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -300); // scroll up → zoom in
    await expect(zoom).not.toHaveText(fit);
  });

  test("native coordinates stay stable across zoom", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page
      .getByRole("button", { name: /^Add Marker/ })
      .first()
      .click();

    const x = page.getByTestId("prop-x");
    const y = page.getByTestId("prop-y");
    const x0 = await x.inputValue();
    const y0 = await y.inputValue();

    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();

    // Zoom only changes the view transform, never the stored native position.
    await expect(x).toHaveValue(x0);
    await expect(y).toHaveValue(y0);
  });
});
