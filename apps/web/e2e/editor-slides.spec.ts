import { expect, test } from "@playwright/test";

test.describe("slides", () => {
  test("adds, duplicates, reorders and deletes slides", async ({ page }) => {
    await page.goto("/plan/local/edit");
    const editing = page.getByTestId("editing-slide");

    // A fresh plan opens on its first slide — there is no Base layout.
    await expect(editing).toContainText("Slide 1");

    await page.getByTestId("add-slide").click();
    await expect(editing).toContainText("Slide 2");
    await page.getByTestId("add-slide").click();
    await expect(editing).toContainText("Slide 3");

    // Exact names: "Duplicate Slide 1" would otherwise also match
    // "Duplicate Slide 1 copy" once the copy exists.
    await page
      .getByRole("button", { name: "Duplicate Slide 1", exact: true })
      .click();
    await expect(editing).toContainText("Slide 1 copy");
    await expect(page.getByTestId("slide-3")).toBeVisible();

    // Reordering moves a slide along the strip.
    await page
      .getByRole("button", { name: "Move Slide 1 later", exact: true })
      .click();
    await expect(page.getByTestId("slide-1")).toContainText("Slide 1");

    await page
      .getByRole("button", { name: "Delete Slide 1", exact: true })
      .click();
    await expect(page.getByTestId("slide-3")).toHaveCount(0);
  });

  test("editing one slide leaves the others exactly where they were", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");

    // Place a token on the opening slide.
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("100");
    await page.getByTestId("prop-y").fill("100");

    // Two more slides that continue from it, so the token is in all three
    // scenes. (A plain "+ Slide" would open an empty stage — see below.)
    await page.getByTestId("continue-slide-0").click();
    await page.getByTestId("continue-slide-1").click();

    // Move it on slide 2 only.
    await page.getByTestId("slide-1").click();
    await page.getByTestId("prop-x").fill("600");
    await expect(page.getByTestId("prop-x")).toHaveValue("600");

    // Slide 1 and slide 3 are untouched — the edit did not cascade forward,
    // which is the whole reason slides replaced base + steps.
    await page.getByTestId("slide-0").click();
    await expect(page.getByTestId("prop-x")).toHaveValue("100");
    await page.getByTestId("slide-2").click();
    await expect(page.getByTestId("prop-x")).toHaveValue("100");

    await page.getByTestId("slide-1").click();
    await expect(page.getByTestId("prop-x")).toHaveValue("600");
  });

  test("animations are authored per slide", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();

    await page.getByTestId("continue-slide-0").click();
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

    // The slide chip shows its animation count.
    await expect(page.getByTestId("slide-1")).toContainText("(1)");

    await page.getByRole("button", { name: "Delete animation" }).click();
    await expect(page.getByTestId("anim-row")).toHaveCount(0);
  });

  test("animates a whole selection in one go", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByTestId("continue-slide-0").click();

    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("add-animation")).toHaveText(
      "+ Animate 2 objects",
    );
    await page.getByTestId("add-animation").click();
    // Two animations, one row: they're identical, so they're edited as one.
    await expect(page.getByTestId("slide-1")).toContainText("(2)");
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
    await expect(page.getByTestId("slide-1")).toContainText("(2)");
  });

  test("the panel inspects the selection; the timeline is the overview", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("continue-slide-0").click();
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
    await page.getByTestId("continue-slide-0").click();
    await page.getByTestId("add-animation").click();
    await expect(page.getByTestId("anim-row")).toHaveCount(1);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByTestId("object-count")).toHaveText("0");
    await expect(page.getByTestId("anim-row")).toHaveCount(0);

    // Deleting took it out of *this* scene. Slide 1 is a different scene and
    // still has it — which is what makes slides independent.
    await page.getByTestId("slide-0").click();
    await expect(page.getByTestId("object-count")).toHaveText("1");
  });

  /**
   * The whole authoring loop for a move, driven the way a planner drives it —
   * because "slides own their objects" makes an empty slide a dead end for
   * animating, and the empty state has to lead out of it.
   */
  test("an empty slide offers to carry the previous one's objects over", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("200");

    // A blank slide: nothing to animate, and the hint says what to do about it.
    await page.getByTestId("add-slide").click();
    await expect(page.getByTestId("empty-slide-hint")).toBeVisible();
    await expect(page.getByTestId("add-animation")).toBeDisabled();

    await page.getByTestId("empty-slide-continue").click();
    await expect(page.getByTestId("empty-slide-hint")).toHaveCount(0);
    // Filled in place — still two slides, not three.
    await expect(page.getByTestId("slide-2")).toHaveCount(0);

    // And now the token is here, so it can be moved and animated.
    await page
      .getByTestId("canvas-container")
      .click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("prop-x")).toHaveValue("200");
    await page.getByTestId("prop-x").fill("900");
    await page.getByTestId("add-animation").click();
    await expect(page.getByTestId("anim-effect")).toHaveValue("move");

    // The opening slide still has it where it started.
    await page.getByTestId("slide-0").click();
    await expect(page.getByTestId("prop-x")).toHaveValue("200");
  });

  test("a slide owns its objects: adding one leaves the other slides alone", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await expect(page.getByTestId("object-count")).toHaveText("1");

    // "+ Slide" is an empty stage, not a copy of the one before it.
    await page.getByTestId("add-slide").click();
    await expect(page.getByTestId("object-count")).toHaveText("0");

    // A token added here belongs to this slide, and to no other.
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await expect(page.getByTestId("object-count")).toHaveText("1");
    await page.getByTestId("slide-0").click();
    await expect(page.getByTestId("object-count")).toHaveText("1");

    // …and "⇥" is how a scene carries on: same cast, same places.
    await page.getByTestId("continue-slide-0").click();
    await expect(page.getByTestId("object-count")).toHaveText("1");
  });
});
