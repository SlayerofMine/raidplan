import { expect, test } from "@playwright/test";

/**
 * Motion paths (plan §7) — the route a `move` follows, drawn on the board.
 *
 * The route lives on the Konva canvas, so it can't be queried like DOM: this
 * drives it the way a planner does — double-click the line to bend it, drag the
 * handle that appears — and reads the result back through the Animation panel,
 * which is the one place a route's shape *is* visible as markup.
 */
test.describe("motion paths", () => {
  /**
   * A token that crosses the board on slide 2, with a move animating it.
   *
   * The positions are chosen so the route's **midpoint is the middle of the
   * board**: a 64px marker at (168,418) has its centre at (200,450), and at
   * (1368,418) at (1400,450), so the line's midpoint is (800,450) — the centre
   * of the 1600×900 background. `fitView` centres the board in its container,
   * so that point is the middle of the canvas element, and a test can aim at
   * the route without doing the camera's arithmetic for it.
   */
  async function seedMove(page: import("@playwright/test").Page) {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("168");
    await page.getByTestId("prop-y").fill("418");

    // Slide 1 is the opening layout, so the move belongs on slide 2.
    await page.getByTestId("add-slide").click();
    await page.getByTestId("prop-x").fill("1368");
    await page.getByTestId("add-animation").click();
    await page.getByTestId("anim-duration").fill("2000");
  }

  /** The middle of the canvas — which, given `seedMove`, is on the route. */
  async function routeMidpoint(page: import("@playwright/test").Page) {
    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  test("a straight move offers no curve, only the hint", async ({ page }) => {
    await seedMove(page);
    await expect(page.getByTestId("anim-route-hint")).toBeVisible();
    await expect(page.getByTestId("anim-curve")).toHaveCount(0);
  });

  test("double-clicking the route bends it, and it can be straightened again", async ({
    page,
  }) => {
    await seedMove(page);

    // Double-click *on the line* — the stroke is hit-tested at `HIT_WIDTH`,
    // not at the 2px it is drawn with.
    const mid = await routeMidpoint(page);
    await page.mouse.dblclick(mid.x, mid.y);

    // A waypoint is a change to `params.path`, which the panel reports.
    await expect(page.getByTestId("anim-route-clear")).toContainText(
      "1 waypoint",
    );
    await expect(page.getByTestId("anim-curve")).toBeVisible();
    await expect(page.getByTestId("anim-route-hint")).toHaveCount(0);

    // Straighten puts it back to a plain two-point move.
    await page.getByTestId("anim-route-clear").click();
    await expect(page.getByTestId("anim-route-hint")).toBeVisible();
  });

  test("the curve is stored on the animation, not on the panel", async ({
    page,
  }) => {
    await seedMove(page);
    const mid = await routeMidpoint(page);
    await page.mouse.dblclick(mid.x, mid.y);
    await expect(page.getByTestId("anim-curve")).toBeVisible();

    await page.getByTestId("anim-curve").fill("1");
    await expect(page.getByTestId("anim-curve")).toHaveValue("1");

    // Leave the slide and come back: a value that lived in component state
    // would be back at 0, and the route would straighten out under it.
    await page.getByTestId("slide-0").click();
    await expect(page.getByTestId("anim-curve")).toHaveCount(0);
    await page.getByTestId("slide-1").click();
    await expect(page.getByTestId("anim-curve")).toHaveValue("1");
    await expect(page.getByTestId("anim-route-clear")).toContainText(
      "1 waypoint",
    );
  });

  test("a routed move actually follows the route when it plays", async ({
    page,
  }) => {
    await seedMove(page);
    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    const mid = await routeMidpoint(page);
    // Drag the new waypoint far off the straight line, so a token that ignored
    // the route and went straight across would be somewhere visibly different.
    await page.mouse.dblclick(mid.x, mid.y);
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, box.y + box.height * 0.15, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByTestId("anim-route-clear")).toContainText(
      "1 waypoint",
    );

    await page.waitForTimeout(1400); // let autosave flush
    await page.getByTestId("open-viewer").click();
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByTestId("viewer-slide")).toContainText("2 / 2");

    const board = page.getByTestId("viewer-canvas");
    const parked = await board.screenshot();

    // Halfway through, the token is up at the waypoint rather than on the
    // straight line between its two slide positions.
    await page.getByTestId("play-toggle").click();
    await page.waitForTimeout(1000);
    const midway = await board.screenshot();
    expect(midway.equals(parked)).toBe(false);

    // And it still lands exactly where slide 2 puts it.
    await expect
      .poll(async () => page.getByTestId("scrub").inputValue(), {
        timeout: 5000,
      })
      .toBe("1");
    await expect(page.getByTestId("viewer-slide")).toContainText("2 / 2");
  });
});
