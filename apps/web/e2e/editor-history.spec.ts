import { expect, test } from "@playwright/test";

/** Phase 2 acceptance: "undo/redo works". */
test.describe("undo / redo", () => {
  test("undoes and redoes adds via the toolbar", async ({ page }) => {
    await page.goto("/plan/local/edit");
    const count = page.getByTestId("object-count");
    const undo = page.getByRole("button", { name: "Undo" });
    const redo = page.getByRole("button", { name: "Redo" });

    // Nothing to undo on a fresh board.
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await expect(count).toHaveText("2");

    await undo.click();
    await expect(count).toHaveText("1");
    await undo.click();
    await expect(count).toHaveText("0");
    await expect(undo).toBeDisabled();

    await redo.click();
    await expect(count).toHaveText("1");
    await redo.click();
    await expect(count).toHaveText("2");
    await expect(redo).toBeDisabled();
  });

  test("undoes and redoes with the keyboard", async ({ page }) => {
    await page.goto("/plan/local/edit");
    const count = page.getByTestId("object-count");

    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await expect(count).toHaveText("1");

    await page.keyboard.press("Control+z");
    await expect(count).toHaveText("0");

    await page.keyboard.press("Control+Shift+z");
    await expect(count).toHaveText("1");
  });

  test("undoes a property edit", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();

    const x = page.getByTestId("prop-x");
    const original = await x.inputValue();
    await x.fill("777");
    await expect(x).toHaveValue("777");

    // Focus is in a text field, so use the toolbar rather than the hotkey.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(x).toHaveValue(original);
  });

  test("selection and camera changes are not undoable", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();

    // Churn the camera and the selection.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Fit" }).click();

    // A single undo must still remove the object — none of the above
    // consumed a history entry.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("object-count")).toHaveText("0");
  });
});
