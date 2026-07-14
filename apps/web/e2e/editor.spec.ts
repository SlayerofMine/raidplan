import { expect, test } from "@playwright/test";

test("adds markers from the palette and deletes the selection", async ({
  page,
}) => {
  await page.goto("/plan/local/edit");

  const count = page.getByTestId("object-count");
  await expect(count).toHaveText("0");

  // Add three markers from the palette.
  const addButtons = page.getByRole("button", { name: /^Add Marker/ });
  await addButtons.nth(0).click();
  await addButtons.nth(1).click();
  await addButtons.nth(2).click();
  await expect(count).toHaveText("3");

  // The most-recently-added marker is selected; Delete removes it.
  await page.keyboard.press("Delete");
  await expect(count).toHaveText("2");
});
