import { expect, test, type Page } from "@playwright/test";

/**
 * Drawing a move (plan §7).
 *
 * A move is a journey the author draws: pick an object, click the corners it
 * turns, press Enter. Each leg becomes its own `move`, chained onto the last —
 * so the route is a row per leg in the Animation panel, each with its own delay
 * and duration, and every one of them is a complete statement on its own slide
 * that needs no second slide to differ from.
 *
 * The route lives on the Konva canvas, so it can't be queried like DOM: these
 * drive it the way a planner does and read the result back through the Animation
 * panel, which is the one place a route's shape *is* visible as markup.
 */
test.describe("drawing a move", () => {
  /** A token on the opening slide, selected and ready to be routed. */
  async function seedToken(page: Page) {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("200");
    await page.getByTestId("prop-y").fill("400");
  }

  /** A point inside the canvas, as a fraction of its box. */
  async function at(page: Page, fx: number, fy: number) {
    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    return { x: box.x + box.width * fx, y: box.y + box.height * fy };
  }

  async function clickBoard(page: Page, fx: number, fy: number) {
    const point = await at(page, fx, fy);
    await page.mouse.click(point.x, point.y);
  }

  test("clicking corners and pressing Enter creates the move", async ({
    page,
  }) => {
    await seedToken(page);
    // No second slide anywhere in this test: a move is self-contained, so the
    // opening slide can carry one.
    await expect(page.getByTestId("draw-move")).toBeEnabled();
    await page.getByTestId("draw-move").click();
    await expect(page.getByTestId("draw-move-active")).toBeVisible();

    await clickBoard(page, 0.4, 0.25);
    await clickBoard(page, 0.7, 0.5);
    await clickBoard(page, 0.85, 0.8);
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("draw-move-active")).toHaveCount(0);
    // Three clicks: three legs, so three moves to time independently.
    await expect(page.getByTestId("anim-row")).toHaveCount(3);
    await expect(page.getByTestId("anim-effect").first()).toHaveValue("move");
    // The first leg opens the slide; the rest follow it, back to back.
    await expect(page.getByTestId("anim-trigger").nth(0)).toHaveValue(
      "onEnter",
    );
    await expect(page.getByTestId("anim-trigger").nth(1)).toHaveValue(
      "afterPrevious",
    );
    await expect(page.getByTestId("anim-trigger").nth(2)).toHaveValue(
      "afterPrevious",
    );
  });

  test("a leg can be made to wait, without touching the ones around it", async ({
    page,
  }) => {
    // The point of a leg per move: "run in, wait two seconds, run out" is one
    // drawn route with a delay on its last leg — no extra slide, no splitting.
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    await clickBoard(page, 0.5, 0.3);
    await clickBoard(page, 0.8, 0.7);
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("anim-row")).toHaveCount(2);
    await page.getByTestId("anim-delay").nth(1).fill("2000");
    await page.getByTestId("anim-duration").nth(1).fill("800");

    // The wait belongs to the second leg alone.
    await expect(page.getByTestId("anim-delay").nth(0)).toHaveValue("0");
    await expect(page.getByTestId("anim-delay").nth(1)).toHaveValue("2000");
    await expect(page.getByTestId("anim-duration").nth(1)).toHaveValue("800");
  });

  test("Escape abandons the draw and leaves nothing behind", async ({
    page,
  }) => {
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    await clickBoard(page, 0.4, 0.3);
    await clickBoard(page, 0.6, 0.6);

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("draw-move-active")).toHaveCount(0);
    // A half-drawn route that got abandoned must leave no trace.
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
  });

  test("Backspace takes back the last corner", async ({ page }) => {
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    await clickBoard(page, 0.4, 0.3);
    await clickBoard(page, 0.6, 0.6);
    await clickBoard(page, 0.8, 0.4);

    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");

    // Three corners, one taken back, so two legs.
    await expect(page.getByTestId("anim-row")).toHaveCount(2);
  });

  test("double-clicking in place ends the route", async ({ page }) => {
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    await clickBoard(page, 0.4, 0.3);

    // Konva calls *any* two clicks inside its 400ms window a double-click, and
    // clicking corners quickly is exactly what drawing looks like — so only a
    // double-click that lands in one spot ends the route. No Enter here.
    const end = await at(page, 0.8, 0.6);
    await page.mouse.dblclick(end.x, end.y);

    await expect(page.getByTestId("draw-move-active")).toHaveCount(0);
    // The corner, plus the destination the double-click landed on — the
    // duplicate its second click left behind is dropped, so two legs.
    await expect(page.getByTestId("anim-row")).toHaveCount(2);
  });

  test("the panel's Finish button ends the draw like Enter does", async ({
    page,
  }) => {
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    await clickBoard(page, 0.4, 0.3);
    await clickBoard(page, 0.7, 0.6);

    // Enter, the double-click and this button all go through the same commit,
    // so all three have to produce exactly the same animation.
    await page.getByTestId("draw-move-finish").click();

    await expect(page.getByTestId("draw-move-active")).toHaveCount(0);
    await expect(page.getByTestId("anim-row")).toHaveCount(2);
    await expect(page.getByTestId("anim-effect").first()).toHaveValue("move");
  });

  test("the panel's Cancel button abandons the draw like Escape does", async ({
    page,
  }) => {
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    await clickBoard(page, 0.4, 0.3);
    await clickBoard(page, 0.7, 0.6);

    await page.getByTestId("draw-move-cancel").click();

    await expect(page.getByTestId("draw-move-active")).toHaveCount(0);
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
    // And the mode is properly left — the button to start again is back.
    await expect(page.getByTestId("draw-move")).toBeEnabled();
  });

  test("finishing with no corners drawn leaves no animation behind", async ({
    page,
  }) => {
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    // Nowhere to go is not a journey, so committing it must not mint an empty
    // move that plays as a no-op.
    await page.getByTestId("draw-move-finish").click();

    await expect(page.getByTestId("draw-move-active")).toHaveCount(0);
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
  });

  test("only one object at a time can have a route drawn for it", async ({
    page,
  }) => {
    await seedToken(page);
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.keyboard.press("Control+a");

    // A route belongs to one object — "draw where these two go" isn't a journey.
    await expect(page.getByTestId("multi-selection")).toContainText(
      "2 objects",
    );
    await expect(page.getByTestId("draw-move")).toBeDisabled();
    // Animating the pair at once is still fine; it's the route that's singular.
    await expect(page.getByTestId("add-animation")).toBeEnabled();
  });

  test("a straight two-point move shows the hint, not the curve", async ({
    page,
  }) => {
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    await clickBoard(page, 0.8, 0.5);
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("anim-route-hint")).toBeVisible();
    await expect(page.getByTestId("anim-curve")).toHaveCount(0);
  });

  test("the drawn route is stored on the animations, not on the panel", async ({
    page,
  }) => {
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    await clickBoard(page, 0.5, 0.25);
    await clickBoard(page, 0.8, 0.6);
    await page.keyboard.press("Enter");

    // Retime one leg, so there is something to lose that isn't a position.
    await page.getByTestId("anim-delay").nth(1).fill("1500");
    await expect(page.getByTestId("anim-delay").nth(1)).toHaveValue("1500");

    // Leave the slide and come back: a value that lived in component state
    // would be back at 0, and the pause between the legs would vanish.
    await page.getByTestId("add-slide").click();
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
    await page.getByTestId("slide-0").click();
    // The new slide is empty, so the selection was dropped on the way there —
    // pick the token up again to inspect what it does here.
    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("anim-row")).toHaveCount(2);
    await expect(page.getByTestId("anim-delay").nth(1)).toHaveValue("1500");
  });

  test("redrawing one leg replaces just that leg", async ({ page }) => {
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    await clickBoard(page, 0.4, 0.3);
    await clickBoard(page, 0.7, 0.6);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("anim-row")).toHaveCount(2);

    // Redraw the *first* leg as two corners: it becomes two legs, and the one
    // that followed it is still there, still after them.
    await page.getByTestId("anim-route-redraw").nth(0).click();
    await clickBoard(page, 0.3, 0.5);
    await clickBoard(page, 0.5, 0.5);
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("anim-row")).toHaveCount(3);
    await expect(page.getByTestId("anim-trigger").nth(0)).toHaveValue(
      "onEnter",
    );
    await expect(page.getByTestId("anim-trigger").nth(2)).toHaveValue(
      "afterPrevious",
    );
  });

  test("an animation added by hand asks to be drawn", async ({ page }) => {
    // `+ Animate selection` makes a move with no destination — it hasn't been
    // drawn yet, and says so rather than silently animating nothing.
    await seedToken(page);
    await page.getByTestId("add-animation").click();

    await expect(page.getByTestId("anim-route-empty")).toBeVisible();
    await page.getByTestId("anim-route-redraw").click();
    await expect(page.getByTestId("draw-move-active")).toBeVisible();

    await clickBoard(page, 0.7, 0.7);
    await page.keyboard.press("Enter");

    // Redrawn in place: still one animation, now with somewhere to go.
    await expect(page.getByTestId("anim-row")).toHaveCount(1);
    await expect(page.getByTestId("anim-route-empty")).toHaveCount(0);
    await expect(page.getByTestId("anim-route-hint")).toBeVisible();
  });

  test("a drawn move actually travels its route when it plays", async ({
    page,
  }) => {
    await seedToken(page);
    await page.getByTestId("draw-move").click();
    // A corner well away from the straight line, so a token that ignored the
    // route would be somewhere visibly different halfway through.
    await clickBoard(page, 0.5, 0.15);
    await clickBoard(page, 0.85, 0.75);
    await page.keyboard.press("Enter");
    // Slow both legs down, so there is plenty of travel to catch mid-flight.
    await page.getByTestId("anim-duration").nth(0).fill("1000");
    await page.getByTestId("anim-duration").nth(1).fill("1000");

    await page.waitForTimeout(1400); // let autosave flush
    await page.getByTestId("open-viewer").click();
    // The opening slide plays its own animations — nothing before it needed.
    await expect(page.getByTestId("viewer-slide")).toContainText("1 / 1");

    const board = page.getByTestId("viewer-canvas");
    const parked = await board.screenshot();

    await page.getByTestId("play-toggle").click();
    await page.waitForTimeout(1000);
    expect((await board.screenshot()).equals(parked)).toBe(false);

    await expect
      .poll(async () => page.getByTestId("scrub").inputValue(), {
        timeout: 5000,
      })
      .toBe("1");
  });
});
