import { expect, test, type Page } from "@playwright/test";

/**
 * The viewer's transport bar (plan §3.6), control by control.
 *
 * `viewer.spec.ts` checks that playback *animates* — that the board actually
 * moves. This is the other half: that the controls around it say the right
 * thing and go the right places. Both matter, and they fail independently — a
 * transport whose Next button is disabled on slide 1 of 3 is broken whether or
 * not the tweens run.
 */
test.describe("viewer transport", () => {
  /** A saved local plan of `slideCount` slides, opened in the viewer. */
  async function openViewer(page: Page, slideCount: number, durationMs = 400) {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();

    for (let slide = 0; slide < slideCount - 1; slide++) {
      await page.getByTestId(`continue-slide-${slide}`).click();
      await page.getByTestId("prop-x").fill(String(300 + slide * 200));
      await page.getByTestId("add-animation").click();
      await page.getByTestId("anim-duration").fill(String(durationMs));
    }

    await page.waitForTimeout(1400); // let autosave flush
    await page.getByTestId("open-viewer").click();
    await expect(page.getByTestId("viewer-canvas")).toBeVisible();
    await expect(page.getByTestId("viewer-slide")).toContainText(
      `1 / ${slideCount}`,
    );
  }

  const controls = (page: Page) => ({
    previous: page.getByRole("button", { name: "Previous slide" }),
    next: page.getByRole("button", { name: "Next slide" }),
    restart: page.getByRole("button", { name: "Restart slide" }),
    fullscreen: page.getByRole("button", { name: "Fullscreen" }),
    play: page.getByTestId("play-toggle"),
    scrub: page.getByTestId("scrub"),
    readout: page.getByTestId("viewer-slide"),
  });

  test("opens on the first slide with Previous already spent", async ({
    page,
  }) => {
    await openViewer(page, 3);
    const c = controls(page);

    // Nowhere to go back to, everywhere to go forward.
    await expect(c.previous).toBeDisabled();
    await expect(c.next).toBeEnabled();
    await expect(c.play).toBeEnabled();
    await expect(c.restart).toBeEnabled();
    await expect(c.fullscreen).toBeEnabled();
  });

  test("Next walks to the end and then stops offering", async ({ page }) => {
    await openViewer(page, 3);
    const c = controls(page);

    await c.next.click();
    await expect(c.readout).toContainText("2 / 3");
    await expect(c.previous).toBeEnabled();
    await expect(c.next).toBeEnabled();

    await c.next.click();
    await expect(c.readout).toContainText("3 / 3");
    // The last slide is the end of the plan, not a wrap-around.
    await expect(c.next).toBeDisabled();
    await expect(c.previous).toBeEnabled();
  });

  test("Previous walks back to the start", async ({ page }) => {
    await openViewer(page, 3);
    const c = controls(page);

    await c.next.click();
    await c.next.click();
    await expect(c.readout).toContainText("3 / 3");

    await c.previous.click();
    await expect(c.readout).toContainText("2 / 3");
    await c.previous.click();
    await expect(c.readout).toContainText("1 / 3");
    await expect(c.previous).toBeDisabled();
  });

  test("the arrow keys do what the buttons do", async ({ page }) => {
    await openViewer(page, 3);
    const c = controls(page);

    await page.keyboard.press("ArrowRight");
    await expect(c.readout).toContainText("2 / 3");
    await page.keyboard.press("ArrowRight");
    await expect(c.readout).toContainText("3 / 3");

    // Past the end is a no-op, matching the disabled button.
    await page.keyboard.press("ArrowRight");
    await expect(c.readout).toContainText("3 / 3");

    await page.keyboard.press("ArrowLeft");
    await expect(c.readout).toContainText("2 / 3");
    await page.keyboard.press("ArrowLeft");
    await expect(c.readout).toContainText("1 / 3");
    await page.keyboard.press("ArrowLeft");
    await expect(c.readout).toContainText("1 / 3");
  });

  test("the play button says which way it will go", async ({ page }) => {
    await openViewer(page, 2);
    const c = controls(page);
    await c.next.click(); // slide 2 has the animation, so it has a duration

    await expect(c.play).toHaveAttribute("aria-label", "Play");
    await c.play.click();
    await expect(c.play).toHaveAttribute("aria-label", "Pause");
    await c.play.click();
    await expect(c.play).toHaveAttribute("aria-label", "Play");
  });

  test("Space plays and pauses", async ({ page }) => {
    await openViewer(page, 2);
    const c = controls(page);
    await c.next.click();

    await page.keyboard.press("Space");
    await expect(c.play).toHaveAttribute("aria-label", "Pause");
    await page.keyboard.press("Space");
    await expect(c.play).toHaveAttribute("aria-label", "Play");
  });

  test("the scrub bar seeks, and reads back where it was put", async ({
    page,
  }) => {
    await openViewer(page, 2);
    const c = controls(page);
    await c.next.click();
    await expect(c.scrub).toHaveValue("0");

    await c.scrub.fill("0.5");
    await expect(c.scrub).toHaveValue("0.5");
    await c.scrub.fill("1");
    await expect(c.scrub).toHaveValue("1");
  });

  test("Restart replays the slide from the beginning", async ({ page }) => {
    // A slow slide, so the rewind is observable rather than over instantly.
    await openViewer(page, 2, 3000);
    const c = controls(page);
    await c.next.click();

    await c.scrub.fill("0.8");
    await expect(c.scrub).toHaveValue("0.8");

    // Restart is "play it again", not merely "rewind": it rebuilds the slide
    // and runs it, so a spent pickup fires a second time.
    await c.restart.click();
    await expect(c.play).toHaveAttribute("aria-label", "Pause");
    await expect
      .poll(async () => Number(await c.scrub.inputValue()))
      .toBeLessThan(0.8);
    // ...and it plays through to the end on its own.
    await expect(c.scrub).toHaveValue("1", { timeout: 10_000 });
  });

  test("changing slide starts the new one from the beginning", async ({
    page,
  }) => {
    await openViewer(page, 3);
    const c = controls(page);

    await c.next.click();
    await c.scrub.fill("0.9");
    await expect(c.scrub).toHaveValue("0.9");

    // A slide you arrive at has not already half-happened.
    await c.next.click();
    await expect(c.readout).toContainText("3 / 3");
    await expect(c.scrub).toHaveValue("0");
  });

  test("the readout names the slide as well as numbering it", async ({
    page,
  }) => {
    await openViewer(page, 2);
    await expect(controls(page).readout).toContainText("Slide 1");
    await controls(page).next.click();
    await expect(controls(page).readout).toContainText("Slide 2");
  });

  test("a one-slide plan has nowhere to go in either direction", async ({
    page,
  }) => {
    await openViewer(page, 1);
    const c = controls(page);

    await expect(c.readout).toContainText("1 / 1");
    await expect(c.previous).toBeDisabled();
    await expect(c.next).toBeDisabled();
    // It is still a plan, and still playable.
    await expect(c.play).toBeEnabled();
  });
});
