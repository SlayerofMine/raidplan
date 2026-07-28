import { expect, test, type Page } from "@playwright/test";

/**
 * The Timeline's playhead and transport (plan §3.4).
 *
 * The half of this feature that jsdom cannot see: the canvas is Konva, the
 * playhead writes Konva node attributes directly, and the editing lock is only
 * meaningful against a real board you can try to drag. So the assertions here
 * are about *behaviour under a real pointer* — that the token actually moves
 * while scrubbing, and actually refuses to be dragged while it does.
 */
test.describe("timeline playhead", () => {
  /** A marker with a 500ms move on slide 1, and the Timeline tray open. */
  async function seedAnimation(page: Page) {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("add-animation").click();
    await expect(page.getByTestId("anim-row")).toHaveCount(1);
    await page.getByTestId("timeline-toggle").click();
  }

  /**
   * The same marker, but animated with something that plainly changes pixels:
   * a `scale` needs no drawn route, so the board differs at any time but 0.
   * Long enough that a single arrow-key step lands mid-tween.
   */
  async function seedVisibleAnimation(page: Page) {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("add-animation").click();
    await page.getByTestId("anim-effect").selectOption("scale");
    await page.getByTestId("anim-duration").fill("1200");
    await page.getByTestId("anim-scale").fill("3");
    await page.getByTestId("timeline-toggle").click();
  }

  /**
   * The board's pixels. Konva draws to a canvas, so what the playhead did is
   * only observable as an image — which is also the strictest form of the
   * claim, since "put it back" has to be exact rather than merely close.
   */
  const board = (page: Page) => page.getByTestId("canvas-container");

  test("the transport reaches the whole slide", async ({ page }) => {
    await seedAnimation(page);
    await expect(page.getByTestId("playhead-time")).toHaveText("0.00s / 0.50s");

    // End is the far edge of the slide, whatever it is.
    await page.getByTestId("timeline-ruler").press("End");
    await expect(page.getByTestId("playhead-time")).toHaveText("0.50s / 0.50s");

    await page.getByTestId("playhead-stop").click();
    await expect(page.getByTestId("playhead-time")).toHaveText("0.00s / 0.50s");
  });

  test("scrubbing moves the board, and stopping puts it back exactly", async ({
    page,
  }) => {
    await seedVisibleAnimation(page);
    const parked = await board(page).screenshot();

    await page.getByTestId("timeline-ruler").press("End");
    await expect
      .poll(async () => (await board(page).screenshot()).equals(parked))
      .toBe(false);

    // The handover back to React: the nodes must land on exactly the values
    // `ObjectNode` renders, not merely near them.
    await page.getByTestId("playhead-stop").click();
    await expect
      .poll(async () => (await board(page).screenshot()).equals(parked))
      .toBe(true);
  });

  test("the editor locks while the playhead is off zero, and unlocks on stop", async ({
    page,
  }) => {
    await seedAnimation(page);
    await expect(page.getByTestId("playback-lock-notice")).toHaveCount(0);
    await expect(page.getByTestId("plan-title")).toBeEnabled();

    await page.getByTestId("timeline-ruler").press("ArrowRight");
    await expect(page.getByTestId("playback-lock-notice")).toBeVisible();
    // The document-writing regions go dead; the Timeline dock does not.
    await expect(page.getByTestId("plan-title")).toBeDisabled();
    await expect(page.getByTestId("add-animation")).toBeDisabled();
    await expect(page.getByTestId("playhead-stop")).toBeEnabled();

    await page.getByTestId("playback-lock-stop").click();
    await expect(page.getByTestId("playback-lock-notice")).toHaveCount(0);
    await expect(page.getByTestId("plan-title")).toBeEnabled();
  });

  test("a token can't be dragged out of a frame of its own animation", async ({
    page,
  }) => {
    await seedVisibleAnimation(page);
    await page.getByTestId("timeline-ruler").press("End");
    await expect(page.getByTestId("playback-lock-notice")).toBeVisible();
    const parked = await board(page).screenshot();

    const box = (await board(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, {
      steps: 5,
    });
    await page.mouse.up();

    expect((await board(page).screenshot()).equals(parked)).toBe(true);
  });

  test("playing runs the slide and stops itself at the end", async ({
    page,
  }) => {
    await seedAnimation(page);
    await page.getByTestId("playhead-play").click();
    // 500ms of slide; the transport clears itself on arrival.
    await expect(page.getByTestId("playhead-play")).toHaveAttribute(
      "aria-label",
      "Play",
      { timeout: 5000 },
    );
    await expect(page.getByTestId("playhead-time")).toHaveText("0.50s / 0.50s");
  });

  /**
   * A drawn two-leg route with a pause between the legs, and the Timeline open.
   *
   * Drawn rather than hand-built: a route compiles to a different tween than a
   * plain `move` — progress along a path, sampled in an `onUpdate` — and it is
   * the shape a planner actually produces.
   *
   * Leg one runs 0–1.00s, the pause 1.00–1.50s, leg two 1.50–2.50s.
   */
  async function seedTwoLegRoute(page: Page) {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("200");
    await page.getByTestId("prop-y").fill("400");
    await page.getByTestId("draw-move").click();
    await page.mouse.click(...(await boardPoint(page, 0.4, 0.25)));
    await page.mouse.click(...(await boardPoint(page, 0.8, 0.7)));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("anim-row")).toHaveCount(2);
    await page.getByTestId("anim-duration").nth(0).fill("1000");
    await page.getByTestId("anim-duration").nth(1).fill("1000");
    await page.getByTestId("anim-delay").nth(1).fill("500");
    await page.getByTestId("timeline-toggle").click();
    await expect(page.getByTestId("playhead-time")).toHaveText("0.00s / 2.50s");
  }

  async function boardPoint(page: Page, fx: number, fy: number) {
    const box = (await board(page).boundingBox())!;
    return [box.x + box.width * fx, box.y + box.height * fy] as const;
  }

  /**
   * The pause between two legs of a drawn move, arrived at from both sides.
   *
   * Regression: stepping *backwards* into the pause dropped the object at its
   * original starting point and left it there until the playhead reached a
   * segment that was mid-tween again. A rewind snaps the board to the slide's
   * opening layout, and between two instants inside a pause no tween's progress
   * changes — so nothing redrew what the snap had just overwritten.
   */
  test("a pause between two move legs looks the same from either direction", async ({
    page,
  }) => {
    await seedTwoLegRoute(page);
    const ruler = page.getByTestId("timeline-ruler");
    // Shift steps ten frames at a time: seven lands at 1.17s, inside the pause.
    const intoTheGap = async (steps: number, key: string) => {
      for (let i = 0; i < steps; i++) await ruler.press(key);
      await expect(page.getByTestId("playhead-time")).toHaveText(
        "1.17s / 2.50s",
      );
    };

    await intoTheGap(7, "Shift+ArrowRight");
    const forwards = await board(page).screenshot();

    // Out to the end and back to the very same instant.
    await ruler.press("End");
    await intoTheGap(8, "Shift+ArrowLeft");

    expect((await board(page).screenshot()).equals(forwards)).toBe(true);
  });

  test("a slow drag backwards through a pause never loses the object", async ({
    page,
  }) => {
    await seedTwoLegRoute(page);
    const ruler = page.getByTestId("timeline-ruler");
    await ruler.press("End");
    // Creep back through leg two and into the pause a frame at a time — the
    // step size that leaves a tween's progress unchanged between seeks.
    for (let i = 0; i < 80; i++) await ruler.press("ArrowLeft");
    await expect(page.getByTestId("playhead-time")).toHaveText("1.17s / 2.50s");
    const crept = await board(page).screenshot();

    await page.getByTestId("playhead-stop").click();
    for (let i = 0; i < 7; i++) await ruler.press("Shift+ArrowRight");
    expect((await board(page).screenshot()).equals(crept)).toBe(true);
  });

  test("looping keeps going instead of stopping at the end", async ({
    page,
  }) => {
    await seedAnimation(page);
    await page.getByTestId("playhead-loop").click();
    await page.getByTestId("playhead-play").click();

    // Past one slide length and still running is the whole claim.
    await page.waitForTimeout(900);
    await expect(page.getByTestId("playhead-play")).toHaveAttribute(
      "aria-label",
      "Pause",
    );
    await page.getByTestId("playhead-play").click();
  });
});
