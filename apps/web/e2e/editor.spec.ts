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
