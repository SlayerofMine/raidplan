import { expect, test, type Page } from "@playwright/test";

/**
 * The Animation panel (plan §3.4 / §7), control by control.
 *
 * The panel's whole job is to stop an author building an animation that doesn't
 * exist: `kind` and `effect` are two independent enums in the document, so
 * nothing in the schema prevents "entrance · disappear" — the picker is what
 * does. These tests hold that vocabulary in place, and check the rows that come
 * and go with it (a route's, a scale's, a collision's) appear exactly when the
 * effect they belong to is selected.
 *
 * Slide 1 carries animations perfectly well — a `move` is a self-contained
 * journey — so none of this needs a second slide.
 */
test.describe("animation panel", () => {
  /** A named marker, selected, with one default animation on slide 1. */
  async function seedAnimation(page: Page) {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("add-animation").click();
    await expect(page.getByTestId("anim-row")).toHaveCount(1);
  }

  test("says what to do when nothing is selected", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await expect(page.getByTestId("anim-no-selection")).toBeVisible();
    // Neither button can do anything without a selection to act on.
    await expect(page.getByTestId("add-animation")).toBeDisabled();
    await expect(page.getByTestId("draw-move")).toBeDisabled();
  });

  test("a selected object with no animations says so", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await expect(page.getByTestId("anim-empty")).toBeVisible();
    await expect(page.getByTestId("anim-list")).toHaveCount(0);
    await expect(page.getByTestId("add-animation")).toBeEnabled();
  });

  test("a new animation lands on the documented defaults", async ({ page }) => {
    await seedAnimation(page);
    await expect(page.getByTestId("anim-kind")).toHaveValue("motion");
    await expect(page.getByTestId("anim-effect")).toHaveValue("move");
    await expect(page.getByTestId("anim-trigger")).toHaveValue("onEnter");
    await expect(page.getByTestId("anim-easing")).toHaveValue("power2.out");
    await expect(page.getByTestId("anim-delay")).toHaveValue("0");
    await expect(page.getByTestId("anim-duration")).toHaveValue("500");
  });

  test("every animation family is offered", async ({ page }) => {
    await seedAnimation(page);
    const kinds = await page
      .getByTestId("anim-kind")
      .locator("option")
      .evaluateAll((options) =>
        options.map((o) => (o as HTMLOptionElement).value),
      );
    expect(kinds).toEqual(["entrance", "exit", "emphasis", "motion"]);
  });

  test("every trigger is offered", async ({ page }) => {
    await seedAnimation(page);
    const triggers = await page
      .getByTestId("anim-trigger")
      .locator("option")
      .evaluateAll((options) =>
        options.map((o) => (o as HTMLOptionElement).value),
      );
    expect(triggers).toEqual([
      "onEnter",
      "withPrevious",
      "afterPrevious",
      "onClick",
      "onCollision",
    ]);
  });

  /**
   * A family offers only its own effects, and lands on the first of them. `fly`
   * is deliberately absent from `exit` — it flies *to* the slide's end state,
   * which is an entrance's job. `move` is likewise absent from `motion`: it is
   * drawn by clicking out its legs, and one picked from a dropdown would have
   * no path to follow.
   */
  for (const [kind, effects] of [
    ["entrance", ["fade", "appear", "fly"]],
    ["exit", ["fade", "disappear"]],
    ["emphasis", ["pulse", "blink"]],
    ["motion", ["scale"]],
  ] as const) {
    test(`the ${kind} family offers exactly its own effects`, async ({
      page,
    }) => {
      await seedAnimation(page);
      await page.getByTestId("anim-kind").selectOption(kind);

      const offered = await page
        .getByTestId("anim-effect")
        .locator("option")
        .evaluateAll((options) =>
          options.map((o) => (o as HTMLOptionElement).value),
        );
      expect(offered).toEqual([...effects]);
      // Switching family lands on that family's first effect.
      await expect(page.getByTestId("anim-effect")).toHaveValue(effects[0]);
    });
  }

  test("changing family drops an effect that doesn't belong to it", async ({
    page,
  }) => {
    await seedAnimation(page);
    await page.getByTestId("anim-kind").selectOption("motion");
    await page.getByTestId("anim-effect").selectOption("scale");
    await expect(page.getByTestId("anim-effect")).toHaveValue("scale");

    // `scale` is not an entrance, so it goes with the family it belonged to
    // rather than staying selected and looking valid.
    await page.getByTestId("anim-kind").selectOption("entrance");
    await expect(page.getByTestId("anim-effect")).toHaveValue("fade");
  });

  test("changing family keeps an effect both families share", async ({
    page,
  }) => {
    await seedAnimation(page);
    await page.getByTestId("anim-kind").selectOption("entrance");
    await expect(page.getByTestId("anim-effect")).toHaveValue("fade");

    // `fade` is in both — it must survive the move, only renamed.
    await page.getByTestId("anim-kind").selectOption("exit");
    await expect(page.getByTestId("anim-effect")).toHaveValue("fade");
  });

  test("fade is named for the direction it runs in", async ({ page }) => {
    await seedAnimation(page);
    const effect = page.getByTestId("anim-effect");

    await page.getByTestId("anim-kind").selectOption("entrance");
    await expect(effect.locator("option[value='fade']")).toHaveText("fade in");
    await expect(effect.locator("option[value='fly']")).toHaveText("fly in");

    await page.getByTestId("anim-kind").selectOption("exit");
    await expect(effect.locator("option[value='fade']")).toHaveText("fade out");
  });

  /** `appear`/`disappear` are switches, not tweens: no duration, no easing. */
  for (const [kind, effect] of [
    ["entrance", "appear"],
    ["exit", "disappear"],
  ] as const) {
    test(`${effect} offers no duration or easing`, async ({ page }) => {
      await seedAnimation(page);
      await page.getByTestId("anim-kind").selectOption(kind);
      await page.getByTestId("anim-effect").selectOption(effect);

      await expect(page.getByTestId("anim-instant")).toBeVisible();
      await expect(page.getByTestId("anim-duration")).toHaveCount(0);
      await expect(page.getByTestId("anim-easing")).toHaveCount(0);
      // Delay still means something — when the switch flips.
      await expect(page.getByTestId("anim-delay")).toBeVisible();
    });
  }

  test("leaving an instant effect brings duration and easing back", async ({
    page,
  }) => {
    await seedAnimation(page);
    await page.getByTestId("anim-kind").selectOption("entrance");
    await page.getByTestId("anim-effect").selectOption("appear");
    await expect(page.getByTestId("anim-duration")).toHaveCount(0);

    await page.getByTestId("anim-effect").selectOption("fade");
    await expect(page.getByTestId("anim-instant")).toHaveCount(0);
    await expect(page.getByTestId("anim-duration")).toBeVisible();
    await expect(page.getByTestId("anim-easing")).toBeVisible();
  });

  test("every easing is offered and selectable", async ({ page }) => {
    await seedAnimation(page);
    const easings = [
      "none",
      "power1.out",
      "power2.out",
      "power2.inOut",
      "power3.out",
      "back.out",
      "elastic.out",
      "bounce.out",
    ];
    const offered = await page
      .getByTestId("anim-easing")
      .locator("option")
      .evaluateAll((options) =>
        options.map((o) => (o as HTMLOptionElement).value),
      );
    expect(offered).toEqual(easings);

    for (const easing of easings) {
      await page.getByTestId("anim-easing").selectOption(easing);
      await expect(page.getByTestId("anim-easing")).toHaveValue(easing);
    }
  });

  test("delay and duration refuse to go negative", async ({ page }) => {
    await seedAnimation(page);
    await page.getByTestId("anim-delay").fill("-250");
    await expect(page.getByTestId("anim-delay")).toHaveValue("0");

    await page.getByTestId("anim-duration").fill("-1");
    await expect(page.getByTestId("anim-duration")).toHaveValue("0");
  });

  test("delay and duration take the values they're given", async ({ page }) => {
    await seedAnimation(page);
    await page.getByTestId("anim-delay").fill("750");
    await page.getByTestId("anim-duration").fill("2400");
    await expect(page.getByTestId("anim-delay")).toHaveValue("750");
    await expect(page.getByTestId("anim-duration")).toHaveValue("2400");
  });

  test("a scale animation gets a scale row, and nothing else does", async ({
    page,
  }) => {
    await seedAnimation(page);
    await expect(page.getByTestId("anim-scale")).toHaveCount(0);

    await page.getByTestId("anim-effect").selectOption("scale");
    await expect(page.getByTestId("anim-scale")).toBeVisible();
    await page.getByTestId("anim-scale").fill("2.5");
    await expect(page.getByTestId("anim-scale")).toHaveValue("2.5");

    // Any other effect, and the row is gone. Reached through the family, since
    // `scale` is the only effect `motion` offers.
    await page.getByTestId("anim-kind").selectOption("emphasis");
    await expect(page.getByTestId("anim-scale")).toHaveCount(0);
  });

  test("a move with no route says so instead of looking finished", async ({
    page,
  }) => {
    await seedAnimation(page);
    // The default effect *is* move, and adding one by hand draws no route.
    await expect(page.getByTestId("anim-route-empty")).toBeVisible();
    await expect(page.getByTestId("anim-route-redraw")).toContainText(
      "Draw the route",
    );
  });

  test("the collider picker appears only for an onCollision trigger", async ({
    page,
  }) => {
    await seedAnimation(page);
    await expect(page.getByTestId("anim-colliders")).toHaveCount(0);

    await page.getByTestId("anim-trigger").selectOption("onCollision");
    await expect(page.getByTestId("anim-colliders")).toBeVisible();

    await page.getByTestId("anim-trigger").selectOption("onClick");
    await expect(page.getByTestId("anim-colliders")).toHaveCount(0);
  });

  test("with nothing else on the board there is nothing to collide with", async ({
    page,
  }) => {
    await seedAnimation(page);
    await page.getByTestId("anim-trigger").selectOption("onCollision");
    // An object can't collide with itself, and it's the only one here.
    await expect(page.getByTestId("anim-colliders-none")).toBeVisible();
  });

  test("a collision with no collider picked is called out", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    // Marker 2 is the selected one; animate it and collide it with Marker 1.
    await page.getByTestId("add-animation").click();
    await page.getByTestId("anim-trigger").selectOption("onCollision");

    await expect(page.getByTestId("anim-colliders-empty")).toBeVisible();
    const collider = page.getByTestId(/^anim-collider-/);
    await expect(collider).toHaveCount(1);

    await collider.check();
    await expect(collider).toBeChecked();
    // Once something is picked the warning has nothing left to say.
    await expect(page.getByTestId("anim-colliders-empty")).toHaveCount(0);
  });

  test("an object is never offered as its own collider", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByRole("button", { name: "Add Marker 3" }).click();
    await page.getByTestId("add-animation").click();
    await page.getByTestId("anim-trigger").selectOption("onCollision");

    // Three objects on the board, two candidates: itself is excluded, because
    // an object overlapping itself would fire on frame one.
    await expect(page.getByTestId(/^anim-collider-/)).toHaveCount(2);
  });

  test("an animation can be deleted from its row", async ({ page }) => {
    await seedAnimation(page);
    await page.getByRole("button", { name: "Delete animation" }).click();
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
    await expect(page.getByTestId("anim-empty")).toBeVisible();
  });

  test("the panel shows only the selection's animations, and counts the rest", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("add-animation").click();
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByTestId("add-animation").click();

    // Marker 2 is selected: one row for it, and a note about the other.
    await expect(page.getByTestId("anim-row")).toHaveCount(1);
    await expect(page.getByTestId("anim-elsewhere")).toContainText("1 more");
  });

  test("animating a multi-selection makes one row that edits them all", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByRole("button", { name: "Add Marker 3" }).click();
    await page.keyboard.press("Control+a");

    await expect(page.getByTestId("add-animation")).toContainText(
      "Animate 3 objects",
    );
    await page.getByTestId("add-animation").click();

    // Three identical animations collapse to one row, because everything the
    // row can edit still agrees.
    const row = page.getByTestId("anim-row");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-objects", "3");

    // Editing the row is one action across all three — and one undo.
    await page.getByTestId("anim-duration").fill("1800");
    await expect(page.getByTestId("anim-duration")).toHaveValue("1800");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("anim-duration")).toHaveValue("500");
    await expect(page.getByTestId("anim-row")).toHaveCount(1);
  });

  test("deleting a shared row removes every animation behind it", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.keyboard.press("Control+a");
    await page.getByTestId("add-animation").click();
    await expect(page.getByTestId("anim-row")).toHaveCount(1);

    await page.getByRole("button", { name: "Delete animation" }).click();
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
    // Nothing left hiding on the objects that weren't in the row's own name.
    await expect(page.getByTestId("anim-elsewhere")).toHaveCount(0);
  });

  test("a row is named for what it animates", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("add-animation").click();

    const name = page.getByTestId("anim-row").getByRole("button").first();
    // A single-object row carries that object's own display name, and follows
    // it when the author renames it — `name` is the editor-side identifier,
    // distinct from the `label` drawn on the board.
    const before = await name.textContent();
    await page.getByTestId("prop-name").fill("Tank 1");
    await expect(name).toHaveText("Tank 1");
    expect(before).not.toBe("Tank 1");

    // A row standing for several objects is named for the count instead.
    await page.getByTestId("prop-name").blur();
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.keyboard.press("Control+a");
    await page.getByTestId("add-animation").click();
    await expect(
      page.getByTestId("anim-row").getByRole("button").first(),
    ).toHaveText("2 objects");
  });

  test("the panel only shows rows while their objects are selected", async ({
    page,
  }) => {
    await seedAnimation(page);
    await expect(page.getByTestId("anim-row")).toHaveCount(1);

    // The panel inspects the selection — deselect and its rows go with it.
    // The animation is still on the slide; the timeline is the overview.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
    await expect(page.getByTestId("anim-no-selection")).toBeVisible();

    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("anim-row")).toHaveCount(1);
  });

  test("a row splits in two when its animations stop agreeing", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    // Far apart, so a sweep can pick out one of them on its own.
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("100");
    await page.getByTestId("prop-y").fill("100");
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByTestId("prop-x").fill("1400");
    await page.getByTestId("prop-y").fill("800");
    // Ctrl+A inside a field selects its text, not the board.
    await page.getByTestId("prop-y").blur();

    await page.keyboard.press("Control+a");
    await page.getByTestId("add-animation").click();
    await expect(page.getByTestId("anim-row")).toHaveAttribute(
      "data-objects",
      "2",
    );

    // Sweep the top-left quadrant: the first marker only.
    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(page.getByTestId("prop-x")).toHaveValue("100");

    // Give it a second animation of its own: the two objects no longer match
    // one-for-one, so the panel stops presenting them as a single thing.
    await page.getByTestId("add-animation").click();
    await expect(page.getByTestId("anim-row")).toHaveCount(2);
    await expect(page.getByTestId("anim-row").first()).toHaveAttribute(
      "data-objects",
      "1",
    );
  });
});
