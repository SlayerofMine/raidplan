import { expect, test } from "@playwright/test";

/** Phase 2 acceptance: "adjust every property". */
test("edits every property of the selected object", async ({ page }) => {
  await page.goto("/plan/local/edit");
  await page.getByRole("button", { name: "Add Marker 1" }).click();
  await expect(page.getByTestId("properties")).toBeVisible();

  await page.getByTestId("prop-x").fill("500");
  await page.getByTestId("prop-y").fill("300");
  await page.getByTestId("prop-w").fill("120");
  await page.getByTestId("prop-h").fill("120");
  await page.getByTestId("prop-rotation").fill("45");
  await page.getByTestId("prop-opacity").fill("0.5");
  await page.getByTestId("prop-label").fill("MT");

  await expect(page.getByTestId("prop-x")).toHaveValue("500");
  await expect(page.getByTestId("prop-y")).toHaveValue("300");
  await expect(page.getByTestId("prop-w")).toHaveValue("120");
  await expect(page.getByTestId("prop-h")).toHaveValue("120");
  await expect(page.getByTestId("prop-rotation")).toHaveValue("45");
  await expect(page.getByTestId("prop-opacity")).toHaveValue("0.5");
  await expect(page.getByTestId("prop-label")).toHaveValue("MT");

  // Visibility and lock are checkboxes.
  await page.getByTestId("prop-visible").uncheck();
  await expect(page.getByTestId("prop-visible")).not.toBeChecked();
  await page.getByTestId("prop-visible").check();

  await page.getByTestId("prop-locked").check();
  await expect(page.getByTestId("prop-locked")).toBeChecked();
});

test("z-order controls reorder without changing the object count", async ({
  page,
}) => {
  await page.goto("/plan/local/edit");
  await page.getByRole("button", { name: "Add Marker 1" }).click();
  await page.getByRole("button", { name: "Add Marker 2" }).click();

  await page.getByRole("button", { name: "Send to back" }).click();
  await expect(page.getByTestId("object-count")).toHaveText("2");
  await page.getByRole("button", { name: "Bring to front" }).click();
  await expect(page.getByTestId("object-count")).toHaveText("2");
});

test("primitives can be added from the toolbar", async ({ page }) => {
  await page.goto("/plan/local/edit");
  for (const name of ["Text", "Rect", "Circle", "Cone", "Arrow"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await expect(page.getByTestId("object-count")).toHaveText("5");
});

test("a locked object cannot be dragged", async ({ page }) => {
  await page.goto("/plan/local/edit");
  await page.getByRole("button", { name: "Add Marker 1" }).click();
  await page.getByTestId("prop-locked").check();

  const x = page.getByTestId("prop-x");
  const x0 = await x.inputValue();

  const box = (await page.getByTestId("canvas-container").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 80, { steps: 6 });
  await page.mouse.up();

  await expect(x).toHaveValue(x0);
});
