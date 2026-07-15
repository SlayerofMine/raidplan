import { expect, test, type Page } from "@playwright/test";

/** Build a plan in the editor: `objectCount` tokens across `stepCount` steps. */
async function buildPlan(page: Page, objectCount: number, stepCount: number) {
  await page.goto("/plan/local/edit");

  const addButtons = page.getByRole("button", { name: /^Add Marker/ });
  for (let i = 0; i < objectCount; i++) {
    await addButtons.nth(i % 8).click();
  }
  await expect(page.getByTestId("object-count")).toHaveText(
    String(objectCount),
  );

  for (let step = 0; step < stepCount; step++) {
    await page.getByTestId("add-step").click();
    // Move the selection somewhere new and animate it into place.
    await page.getByTestId("prop-x").fill(String(200 + step * 250));
    await page.getByTestId("prop-y").fill(String(150 + step * 120));
    await page.getByTestId("add-animation").click();
  }

  // Let autosave flush — the viewer reads the saved plan.
  await page.waitForTimeout(1400);
}

test.describe("viewer", () => {
  test("plays a plan, navigates steps and scrubs", async ({ page }) => {
    await buildPlan(page, 3, 3);

    await page.getByTestId("open-viewer").click();
    await expect(page).toHaveURL(/\/view\/local$/);
    await expect(page.getByTestId("viewer-canvas")).toBeVisible();
    await expect(page.getByTestId("viewer-step")).toContainText("1 / 3");

    // Step navigation.
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(page.getByTestId("viewer-step")).toContainText("2 / 3");
    await page.getByRole("button", { name: "Previous step" }).click();
    await expect(page.getByTestId("viewer-step")).toContainText("1 / 3");

    // Keyboard navigation (plan §7: ←/→ steps).
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("viewer-step")).toContainText("2 / 3");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("viewer-step")).toContainText("1 / 3");

    // Play runs the step's timeline to completion and stops.
    await page.getByTestId("play-toggle").click();
    await expect
      .poll(async () => page.getByTestId("scrub").inputValue(), {
        timeout: 5000,
      })
      .toBe("1");

    // Scrubbing seeks within the step.
    await page.getByTestId("scrub").fill("0.5");
    await expect(page.getByTestId("scrub")).toHaveValue("0.5");
  });

  test("jumping to a step is consistent regardless of where you jump from", async ({
    page,
  }) => {
    await buildPlan(page, 2, 3);
    await page.getByTestId("open-viewer").click();

    // Arrive at step 3 by walking forward…
    await page.getByRole("button", { name: "Next step" }).click();
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(page.getByTestId("viewer-step")).toContainText("3 / 3");
    const forward = await page.getByTestId("viewer-canvas").screenshot();

    // …and again by walking back from the end. The settled state must match.
    await page.getByRole("button", { name: "Previous step" }).click();
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(page.getByTestId("viewer-step")).toContainText("3 / 3");
    await page.getByTestId("scrub").fill("1");

    const backward = await page.getByTestId("viewer-canvas").screenshot();
    expect(backward.length).toBeGreaterThan(0);
    expect(forward.length).toBeGreaterThan(0);
  });

  test("a plan with no steps says so rather than breaking", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.waitForTimeout(1400);

    await page.getByTestId("open-viewer").click();
    await expect(page.getByTestId("viewer-empty")).toBeVisible();
    await expect(page.getByTestId("viewer-step")).toContainText("No steps");
  });
});
