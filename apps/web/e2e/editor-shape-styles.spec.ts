import { expect, test, type Page } from "@playwright/test";

/**
 * Shape form and colour (plan §2.4).
 *
 * Style is *form* — how a shape is filled, whether it is outlined, how a
 * voidzone's edge is cut — and is deliberately separate from Tint, which is
 * colour. Each primitive offers only the fills that mean something for it, so
 * this walks every one of them: the panel is the only thing standing between an
 * author and a `striped` rectangle the renderer has no drawing for.
 */
test.describe("shape styles", () => {
  /** Add one primitive from the Shapes tab; it comes up selected. */
  async function addShape(page: Page, label: string) {
    await page.goto("/plan/local/edit");
    await page.getByRole("tab", { name: "Shapes" }).click();
    await page.getByRole("button", { name: `Add ${label}` }).click();
    await expect(page.getByTestId("properties")).toBeVisible();
  }

  const optionValues = (page: Page, testId: string) =>
    page
      .getByTestId(testId)
      .locator("option")
      .evaluateAll((options) =>
        options.map((o) => (o as HTMLOptionElement).value),
      );

  /**
   * What each primitive is allowed to be filled with, and what it starts as.
   * `striped` belongs to the round mechanics only, and `hazard` — the radial
   * danger wash — is the voidzone's own default.
   */
  const SHAPES = [
    { label: "Rect", fills: ["soft", "solid", "none"], initial: "soft" },
    {
      label: "Circle",
      fills: ["soft", "solid", "striped", "none"],
      initial: "soft",
    },
    { label: "Cone", fills: ["soft", "solid", "none"], initial: "soft" },
    { label: "Beam", fills: ["soft", "solid", "none"], initial: "soft" },
    { label: "Soak", fills: ["soft", "solid", "none"], initial: "soft" },
    { label: "Pickup", fills: ["soft", "solid", "none"], initial: "soft" },
    {
      label: "Void",
      fills: ["soft", "solid", "striped", "hazard", "none"],
      initial: "hazard",
    },
  ] as const;

  for (const { label, fills, initial } of SHAPES) {
    test(`${label} offers exactly its own fills, starting on ${initial}`, async ({
      page,
    }) => {
      await addShape(page, label);
      expect(await optionValues(page, "style-fill")).toEqual([...fills]);
      await expect(page.getByTestId("style-fill")).toHaveValue(initial);
    });

    test(`every ${label} fill can be chosen and sticks`, async ({ page }) => {
      await addShape(page, label);
      for (const fill of fills) {
        await page.getByTestId("style-fill").selectOption(fill);
        await expect(page.getByTestId("style-fill")).toHaveValue(fill);
      }
    });
  }

  test("only a voidzone has an edge to choose", async ({ page }) => {
    await addShape(page, "Void");
    expect(await optionValues(page, "style-edge")).toEqual([
      "scalloped",
      "round",
    ]);
    await expect(page.getByTestId("style-edge")).toHaveValue("scalloped");
    await page.getByTestId("style-edge").selectOption("round");
    await expect(page.getByTestId("style-edge")).toHaveValue("round");

    // Every other shape has one edge and no choice about it.
    for (const label of ["Rect", "Circle", "Cone", "Soak"]) {
      await addShape(page, label);
      await expect(page.getByTestId("style-edge")).toHaveCount(0);
    }
  });

  test("the outline is on by default and can be turned off", async ({
    page,
  }) => {
    await addShape(page, "Rect");
    const outline = page.getByTestId("style-outline");
    await expect(outline).toBeChecked();

    await outline.uncheck();
    await expect(outline).not.toBeChecked();
    await outline.check();
    await expect(outline).toBeChecked();
  });

  test("a token has no style controls — there is no form to change", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await expect(page.getByTestId("properties")).toBeVisible();

    await expect(page.getByTestId("style-fill")).toHaveCount(0);
    await expect(page.getByTestId("style-outline")).toHaveCount(0);
    await expect(page.getByTestId("style-edge")).toHaveCount(0);
    await expect(page.getByTestId("style-line")).toHaveCount(0);
    // Colour is not form, so every object keeps its tint.
    await expect(page.getByTestId("prop-tint")).toBeVisible();
  });

  for (const primitive of ["Text", "Arrow"] as const) {
    test(`${primitive} is a primitive, not a shape, so it has no fill`, async ({
      page,
    }) => {
      await addShape(page, primitive);
      await expect(page.getByTestId("style-fill")).toHaveCount(0);
      await expect(page.getByTestId("style-outline")).toHaveCount(0);
    });
  }

  test("style survives a reload", async ({ page }) => {
    await addShape(page, "Void");
    await page.getByTestId("style-fill").selectOption("striped");
    await page.getByTestId("style-edge").selectOption("round");
    await page.getByTestId("style-outline").uncheck();

    // Autosave is debounced (~1s idle).
    await page.waitForTimeout(1600);
    await page.reload();

    // Wait for the saved plan to hydrate — select-all on an empty store
    // selects nothing, and there'd be no panel to read.
    await expect(page.getByTestId("object-count")).toHaveText("1");
    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("style-fill")).toHaveValue("striped");
    await expect(page.getByTestId("style-edge")).toHaveValue("round");
    await expect(page.getByTestId("style-outline")).not.toBeChecked();
  });

  test("a style change is undoable", async ({ page }) => {
    await addShape(page, "Circle");
    await page.getByTestId("style-fill").selectOption("striped");
    await expect(page.getByTestId("style-fill")).toHaveValue("striped");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("style-fill")).toHaveValue("soft");
  });
});

/**
 * Tint (plan §2.4) — colour, applied to every kind of object, and the one
 * property a shape shares with a token.
 */
test.describe("tint", () => {
  test("defaults to the house accent and takes a new colour", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();

    const tint = page.getByTestId("prop-tint");
    await expect(tint).toHaveValue("#4f9dff");

    await tint.fill("#ff0000");
    await expect(tint).toHaveValue("#ff0000");
  });

  test("survives a reload and is undoable", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-tint").fill("#00ff88");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("prop-tint")).toHaveValue("#4f9dff");

    await page.getByTestId("prop-tint").fill("#00ff88");
    await page.waitForTimeout(1600);
    await page.reload();
    await expect(page.getByTestId("object-count")).toHaveText("1");
    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("prop-tint")).toHaveValue("#00ff88");
  });

  test("is per object, not a global setting", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-tint").fill("#ff0000");

    // A second marker starts on the default rather than inheriting the first's.
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await expect(page.getByTestId("prop-tint")).toHaveValue("#4f9dff");
  });
});
