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

  test("dragging on empty canvas rubber-band selects the swept tokens", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");

    // Spread three tokens across known native coordinates.
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("100");
    await page.getByTestId("prop-y").fill("100");
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByTestId("prop-x").fill("300");
    await page.getByTestId("prop-y").fill("100");
    await page.getByRole("button", { name: "Add Marker 3" }).click();
    await page.getByTestId("prop-x").fill("1400");
    await page.getByTestId("prop-y").fill("800");

    // Sweep the top-left quadrant: should catch the first two, not the third.
    // The sweep is non-additive, so it replaces whatever was selected.
    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
      steps: 8,
    });
    await page.mouse.up();

    await expect(page.getByTestId("multi-selection")).toContainText(
      "2 objects",
    );
  });

  test("a click on empty canvas clears the selection without sweeping", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await expect(page.getByTestId("properties")).toBeVisible();

    // A press with no drag must not select everything — it just deselects.
    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    await page.mouse.click(box.x + 6, box.y + 6);
    await expect(page.getByTestId("no-selection")).toBeVisible();
  });

  test("shift-sweeping adds to the existing selection", async ({ page }) => {
    await page.goto("/plan/local/edit");

    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("100");
    await page.getByTestId("prop-y").fill("100");
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByTestId("prop-x").fill("1400");
    await page.getByTestId("prop-y").fill("700");

    // Keep marker 2 selected, then shift-sweep marker 1's corner.
    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    await page.keyboard.down("Shift");
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35, {
      steps: 6,
    });
    await page.mouse.up();
    await page.keyboard.up("Shift");

    await expect(page.getByTestId("multi-selection")).toContainText(
      "2 objects",
    );
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
    // Clear the selection first: a selected token shows its origin crosshair
    // right at its centre (plan §18.17), and grabbing dead-centre would drag the
    // origin, not the token. Deselected, the same press lands on the body, which
    // selects and drags it — the gesture a planner actually makes.
    await page.mouse.click(box.x + 6, box.y + 6);
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
