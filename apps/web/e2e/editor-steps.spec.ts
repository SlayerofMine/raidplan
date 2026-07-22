import { expect, test } from "@playwright/test";

test.describe("steps", () => {
  test("adds, duplicates, reorders and deletes steps", async ({ page }) => {
    await page.goto("/plan/local/edit");
    const editing = page.getByTestId("editing-step");

    // A fresh plan starts on the base layout.
    await expect(editing).toContainText("Base");

    await page.getByTestId("add-step").click();
    await expect(editing).toContainText("Step 1");
    await page.getByTestId("add-step").click();
    await expect(editing).toContainText("Step 2");

    // Exact names: "Duplicate Step 1" would otherwise also match
    // "Duplicate Step 1 copy" once the copy exists.
    await page
      .getByRole("button", { name: "Duplicate Step 1", exact: true })
      .click();
    await expect(editing).toContainText("Step 1 copy");
    await expect(page.getByTestId("step-2")).toBeVisible();

    // Reordering moves a step along the strip.
    await page
      .getByRole("button", { name: "Move Step 1 later", exact: true })
      .click();
    await expect(page.getByTestId("step-1")).toContainText("Step 1");

    // Back to base and around again.
    await page.getByTestId("step-base").click();
    await expect(editing).toContainText("Base");

    await page
      .getByRole("button", { name: "Delete Step 1", exact: true })
      .click();
    await expect(page.getByTestId("step-2")).toHaveCount(0);
  });

  test("editing on a step overrides it without moving the base layout", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");

    // Place a token on the base layout.
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("100");
    await page.getByTestId("prop-y").fill("100");

    // On a new step, move it: the step shows the new spot…
    await page.getByTestId("add-step").click();
    await page.getByTestId("prop-x").fill("600");
    await expect(page.getByTestId("prop-x")).toHaveValue("600");

    // …but the base layout still has it where it started.
    await page.getByTestId("step-base").click();
    await expect(page.getByTestId("prop-x")).toHaveValue("100");

    // And stepping forward shows the override again.
    await page.getByTestId("step-0").click();
    await expect(page.getByTestId("prop-x")).toHaveValue("600");
  });

  test("animations are authored per step", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();

    // The base layout has no animations.
    await expect(page.getByTestId("anim-base-hint")).toBeVisible();

    await page.getByTestId("add-step").click();
    await expect(page.getByTestId("anim-empty")).toBeVisible();

    await page.getByTestId("add-animation").click();
    await expect(page.getByTestId("anim-row")).toHaveCount(1);

    // The family first, then its own effects — an entrance's "fade" is a fade in.
    await page.getByTestId("anim-kind").selectOption("entrance");
    await page.getByTestId("anim-effect").selectOption("fade");
    await expect(page.getByTestId("anim-effect")).toHaveValue("fade");
    await page.getByTestId("anim-duration").fill("800");
    await expect(page.getByTestId("anim-effect")).toHaveValue("fade");
    await expect(page.getByTestId("anim-duration")).toHaveValue("800");

    // The step chip shows its animation count.
    await expect(page.getByTestId("step-0")).toContainText("(1)");

    await page.getByRole("button", { name: "Delete animation" }).click();
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
  });

  test("animates a whole selection in one go", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByTestId("add-step").click();

    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("add-animation")).toHaveText(
      "+ Animate 2 objects",
    );
    await page.getByTestId("add-animation").click();
    // Two animations, one row: they're identical, so they're edited as one.
    await expect(page.getByTestId("step-0")).toContainText("(2)");
    await expect(page.getByTestId("anim-row")).toHaveCount(1);
    await expect(page.getByTestId("anim-row")).toHaveAttribute(
      "data-objects",
      "2",
    );

    // One action, so one undo — not two presses to take back one click.
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
    await page.keyboard.press("Control+y");
    await expect(page.getByTestId("anim-row")).toHaveCount(1);

    // Editing the row edits both. If only one had changed they would no longer
    // agree, and the row would split in two.
    await page.getByTestId("anim-effect").selectOption("scale");
    await expect(page.getByTestId("anim-row")).toHaveCount(1);
    await expect(page.getByTestId("anim-row")).toHaveAttribute(
      "data-objects",
      "2",
    );
    await expect(page.getByTestId("step-0")).toContainText("(2)");
  });

  test("the panel inspects the selection; the timeline is the overview", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("add-step").click();
    await page.getByTestId("add-animation").click();
    await expect(page.getByTestId("anim-row")).toHaveCount(1);

    // A second object, selected: the first object's animation is no longer
    // this panel's business — but it says how many it isn't showing.
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
    await expect(page.getByTestId("anim-elsewhere")).toContainText("1 more");

    // Clicking its bar in the timeline selects its object, which brings the
    // animation back into the panel — the two halves navigate to each other.
    await page.getByTestId("timeline-toggle").click();
    await page.locator('[data-testid^="timeline-bar-"]').first().click();
    await expect(page.getByTestId("anim-row")).toHaveCount(1);
    await expect(page.getByTestId("anim-elsewhere")).toHaveCount(0);
  });

  test("deleting an object removes its animations", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("add-step").click();
    await page.getByTestId("add-animation").click();
    await expect(page.getByTestId("anim-row")).toHaveCount(1);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByTestId("object-count")).toHaveText("0");
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
  });
});
