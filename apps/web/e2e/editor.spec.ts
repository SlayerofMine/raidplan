import { expect, test } from "@playwright/test";

test("adds markers from the palette and deletes via toolbar and keyboard", async ({
  page,
}) => {
  await page.goto("/plan/local/edit");

  const count = page.getByTestId("object-count");
  await expect(count).toHaveText("0");

  // Add ten markers (cycling through the eight palette icons).
  const addButtons = page.getByRole("button", { name: /^Add Marker/ });
  for (let i = 0; i < 10; i++) {
    await addButtons.nth(i % 8).click();
  }
  await expect(count).toHaveText("10");

  // The most-recent add is selected; the toolbar Delete button removes it.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(count).toHaveText("9");

  // Keyboard Delete removes the current selection too.
  await addButtons.first().click();
  await expect(count).toHaveText("10");
  await page.keyboard.press("Delete");
  await expect(count).toHaveText("9");
});

test("copy/paste, duplicate and select-all work from the keyboard", async ({
  page,
}) => {
  await page.goto("/plan/local/edit");
  const count = page.getByTestId("object-count");

  await page.getByRole("button", { name: "Add Marker 1" }).click();
  await expect(count).toHaveText("1");

  // Copy once, paste twice.
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(count).toHaveText("2");
  await page.keyboard.press("Control+v");
  await expect(count).toHaveText("3");

  // Duplicate acts on the current selection.
  await page.keyboard.press("Control+d");
  await expect(count).toHaveText("4");

  // Select-all then delete clears the board.
  await page.keyboard.press("Control+a");
  await expect(page.getByTestId("multi-selection")).toContainText("4 objects");
  await page.keyboard.press("Delete");
  await expect(count).toHaveText("0");
});
