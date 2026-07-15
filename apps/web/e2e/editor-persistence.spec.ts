import { expect, test } from "@playwright/test";

/**
 * Phase 2 acceptance: "build a 30-token board … export→import round-trips,
 * autosave restores after reload".
 */
test("autosave restores a 30-token board after reload", async ({ page }) => {
  await page.goto("/plan/local/edit");
  const count = page.getByTestId("object-count");

  const addButtons = page.getByRole("button", { name: /^Add Marker/ });
  for (let i = 0; i < 30; i++) {
    await addButtons.nth(i % 8).click();
  }
  await expect(count).toHaveText("30");

  await page.getByTestId("plan-title").fill("Autosaved plan");

  // Autosave is debounced (~1s idle) — give it room to flush, then reload.
  await page.waitForTimeout(1600);
  await page.reload();

  await expect(count).toHaveText("30");
  await expect(page.getByTestId("plan-title")).toHaveValue("Autosaved plan");
});

test("export → import round-trips the plan", async ({ page }) => {
  await page.goto("/plan/local/edit");
  const count = page.getByTestId("object-count");

  await page.getByRole("button", { name: "Add Marker 1" }).click();
  await page.getByRole("button", { name: "Add Marker 2" }).click();
  await page.getByTestId("plan-title").fill("Round trip");
  await expect(count).toHaveText("2");

  // Export writes a .json file.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("round-trip.json");
  const file = await download.path();

  // Wipe the board.
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(count).toHaveText("0");

  // Importing the exported file restores it exactly.
  await page.getByTestId("import-input").setInputFiles(file);
  await expect(count).toHaveText("2");
  await expect(page.getByTestId("plan-title")).toHaveValue("Round trip");
});

test("importing a non-plan JSON file is rejected", async ({ page }) => {
  await page.goto("/plan/local/edit");
  await page.getByRole("button", { name: "Add Marker 1" }).click();

  page.on("dialog", (d) => d.dismiss());
  await page.getByTestId("import-input").setInputFiles({
    name: "junk.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"hello":"world"}'),
  });

  // The board is left untouched.
  await expect(page.getByTestId("object-count")).toHaveText("1");
});
