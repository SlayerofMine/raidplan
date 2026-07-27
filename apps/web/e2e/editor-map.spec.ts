import { expect, test } from "@playwright/test";

/**
 * Choosing the map the plan is drawn on (plan §4.8).
 *
 * A map is not just a picture: each one has its own native size, and the board's
 * coordinate space is that size. So switching maps changes what "fit to the
 * window" means, which is the observable difference between picking a map and
 * merely selecting an option.
 */
test.describe("map picker", () => {
  /** The bundled maps, and the native board each one implies. */
  const MAPS = [
    { id: "arena", name: "Arena", width: 1600, height: 900 },
    { id: "chamber", name: "Boss chamber", width: 1600, height: 900 },
    { id: "corridor", name: "Corridor", width: 1920, height: 800 },
  ] as const;

  test("offers exactly the bundled maps, and opens on the first", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    const picker = page.getByTestId("map-picker");
    // `evaluateAll` reads whatever is there right now — unlike the matchers, it
    // doesn't wait for the picker to mount.
    await expect(picker.locator("option")).toHaveCount(MAPS.length);

    const values = await picker
      .locator("option")
      .evaluateAll((options) =>
        options.map((o) => (o as HTMLOptionElement).value),
      );
    expect(values).toEqual(MAPS.map((m) => m.id));
    await expect(picker).toHaveValue("arena");
  });

  for (const map of MAPS) {
    test(`${map.name} can be chosen`, async ({ page }) => {
      await page.goto("/plan/local/edit");
      await page.getByTestId("map-picker").selectOption(map.id);
      await expect(page.getByTestId("map-picker")).toHaveValue(map.id);
    });
  }

  test("switching to a differently-shaped map changes what Fit means", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    const zoom = page.getByTestId("zoom-level");

    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const onArena = (await zoom.textContent())!;

    // Corridor is 1920×800 where Arena is 1600×900 — a different board, so a
    // different scale fits it.
    await page.getByTestId("map-picker").selectOption("corridor");
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(zoom).not.toHaveText(onArena);

    // ...and a map of the same size fits identically.
    await page.getByTestId("map-picker").selectOption("arena");
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(zoom).toHaveText(onArena);

    await page.getByTestId("map-picker").selectOption("chamber");
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(zoom).toHaveText(onArena);
  });

  test("changing the map keeps the objects on the board", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("640");
    await page.getByTestId("prop-y").fill("360");

    await page.getByTestId("map-picker").selectOption("corridor");

    // The map is scenery; it doesn't move or drop what's been placed on it.
    await expect(page.getByTestId("object-count")).toHaveText("1");
    await expect(page.getByTestId("prop-x")).toHaveValue("640");
    await expect(page.getByTestId("prop-y")).toHaveValue("360");
  });

  test("the chosen map survives a reload", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByTestId("map-picker").selectOption("corridor");

    await page.waitForTimeout(1600); // autosave is debounced
    await page.reload();

    await expect(page.getByTestId("map-picker")).toHaveValue("corridor");
  });

  test("changing the map is undoable", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByTestId("map-picker").selectOption("chamber");
    await expect(page.getByTestId("map-picker")).toHaveValue("chamber");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("map-picker")).toHaveValue("arena");
  });

  test("the upload control accepts only the formats we store", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    // SVG is deliberately absent: it is a script-bearing document, and serving
    // one from our own origin would be stored XSS (see validateUpload).
    await expect(page.getByTestId("upload-map-input")).toHaveAttribute(
      "accept",
      "image/png,image/jpeg,image/webp,image/gif",
    );
  });
});
