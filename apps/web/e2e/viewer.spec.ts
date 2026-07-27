import { expect, test, type Page } from "@playwright/test";

/**
 * Build a plan in the editor: `objectCount` tokens across `slideCount` slides.
 *
 * A plan opens with one slide already, and that one is static — it has nothing
 * before it to move from — so the animated slides are the `slideCount - 1`
 * added on top of it.
 */
async function buildPlan(page: Page, objectCount: number, slideCount: number) {
  await page.goto("/plan/local/edit");

  const addButtons = page.getByRole("button", { name: /^Add Marker/ });
  for (let i = 0; i < objectCount; i++) {
    await addButtons.nth(i % 8).click();
  }
  await expect(page.getByTestId("object-count")).toHaveText(
    String(objectCount),
  );

  for (let slide = 0; slide < slideCount - 1; slide++) {
    // Continue from the slide we're on, so the tokens are in every scene and
    // have somewhere to move from.
    await page.getByTestId(`continue-slide-${slide}`).click();
    // Move the selection somewhere new and animate it into place.
    await page.getByTestId("prop-x").fill(String(200 + slide * 250));
    await page.getByTestId("prop-y").fill(String(150 + slide * 120));
    await page.getByTestId("add-animation").click();
  }

  // Let autosave flush — the viewer reads the saved plan.
  await page.waitForTimeout(1400);
}

test.describe("viewer", () => {
  test("a scale animation actually resizes while playing", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    // On slide 2: slide 1 is the opening layout and animates nothing.
    await page.getByTestId("continue-slide-0").click();
    await page.getByTestId("add-animation").click();
    await page.getByTestId("anim-effect").selectOption("scale");
    await page.getByTestId("anim-duration").fill("1200");
    // How much it grows — the animation's own, not a size difference between
    // two slides.
    await page.getByTestId("anim-scale").fill("3");
    await page.waitForTimeout(1400); // let autosave flush

    await page.getByTestId("open-viewer").click();
    const board = page.getByTestId("viewer-canvas");
    await expect(board).toBeVisible();
    // The viewer opens on slide 1; the scale lives on slide 2.
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByTestId("viewer-slide")).toContainText("2 / 2");
    const before = await board.screenshot();

    // React isn't in the frame loop, so nothing but the animator can resize the
    // node: `scale` used to be a no-op everywhere but the editor's own canvas.
    await page.getByTestId("play-toggle").click();
    await expect
      .poll(async () => (await board.screenshot()).equals(before))
      .toBe(false);
  });

  test("plays a plan, navigates slides and scrubs", async ({ page }) => {
    await buildPlan(page, 3, 3);

    await page.getByTestId("open-viewer").click();
    await expect(page).toHaveURL(/\/view\/local$/);
    await expect(page.getByTestId("viewer-canvas")).toBeVisible();
    await expect(page.getByTestId("viewer-slide")).toContainText("1 / 3");

    // Slide navigation.
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByTestId("viewer-slide")).toContainText("2 / 3");
    await page.getByRole("button", { name: "Previous slide" }).click();
    await expect(page.getByTestId("viewer-slide")).toContainText("1 / 3");

    // Keyboard navigation (plan §7: ←/→ slides).
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("viewer-slide")).toContainText("2 / 3");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("viewer-slide")).toContainText("1 / 3");

    // Onto an animated slide — slide 1 is the opening layout, and a slide with
    // no timeline has no progress to run through or scrub along.
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByTestId("viewer-slide")).toContainText("2 / 3");

    // Play runs the slide's timeline to completion and stops.
    await page.getByTestId("play-toggle").click();
    await expect
      .poll(async () => page.getByTestId("scrub").inputValue(), {
        timeout: 5000,
      })
      .toBe("1");

    // Scrubbing seeks within the slide.
    await page.getByTestId("scrub").fill("0.5");
    await expect(page.getByTestId("scrub")).toHaveValue("0.5");
  });

  test("jumping to a slide is consistent regardless of where you jump from", async ({
    page,
  }) => {
    await buildPlan(page, 2, 3);
    await page.getByTestId("open-viewer").click();

    // Arrive at slide 3 by walking forward…
    await page.getByRole("button", { name: "Next slide" }).click();
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByTestId("viewer-slide")).toContainText("3 / 3");
    const forward = await page.getByTestId("viewer-canvas").screenshot();

    // …and again by walking back from the end. The settled state must match.
    await page.getByRole("button", { name: "Previous slide" }).click();
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByTestId("viewer-slide")).toContainText("3 / 3");
    await page.getByTestId("scrub").fill("1");

    const backward = await page.getByTestId("viewer-canvas").screenshot();
    expect(backward.length).toBeGreaterThan(0);
    expect(forward.length).toBeGreaterThan(0);
  });

  test("a plan nobody has added slides to still opens on its first one", async ({
    page,
  }) => {
    // There is no "no slides" state left to guard against: a plan always has
    // an opening slide, so the viewer always has something to show.
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.waitForTimeout(1400);

    await page.getByTestId("open-viewer").click();
    await expect(page.getByTestId("viewer-canvas")).toBeVisible();
    await expect(page.getByTestId("viewer-slide")).toContainText("1 / 1");
  });
});
