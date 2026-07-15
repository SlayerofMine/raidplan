import { expect, test } from "@playwright/test";

test.describe("selection & movement", () => {
  test("adding an icon selects it and fills the properties panel", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await expect(page.getByTestId("no-selection")).toBeVisible();

    await page
      .getByRole("button", { name: /^Add Marker/ })
      .first()
      .click();
    await expect(page.getByTestId("properties")).toBeVisible();
    await expect(page.getByTestId("no-selection")).toHaveCount(0);
  });

  test("Escape clears the selection", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page
      .getByRole("button", { name: /^Add Marker/ })
      .first()
      .click();
    await expect(page.getByTestId("properties")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("no-selection")).toBeVisible();
  });

  test("dragging a token on the canvas updates its native position", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    // A palette click drops the token at the centre of the current view, i.e.
    // the centre of the canvas container — so that's where we grab it.
    await page
      .getByRole("button", { name: /^Add Marker/ })
      .first()
      .click();

    const x = page.getByTestId("prop-x");
    const y = page.getByTestId("prop-y");
    const x0 = Number(await x.inputValue());
    const y0 = Number(await y.inputValue());

    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 80, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => Number(await x.inputValue()))
      .toBeGreaterThan(x0);
    await expect
      .poll(async () => Number(await y.inputValue()))
      .toBeGreaterThan(y0);
  });
});
