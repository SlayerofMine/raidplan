import { expect, test, type Page } from "@playwright/test";

/**
 * Attacks, end to end (plan §21).
 *
 * The three things the design is actually a bet on:
 *
 *  1. an attack authored in the designer places into a plan and **plays**,
 *     because it resolves at drop into ordinary objects and animations;
 *  2. retiming a placement out and back lands on the authored timings
 *     **exactly** — the drift the whole "recipe, not a result" model exists to
 *     make impossible, checked through the UI rather than in a unit test;
 *  3. deleting an attack takes the attack and nothing else, so the token its
 *     slot was bound to survives.
 */

/** Open the local scratch plan, cleared of anything a previous test left. */
async function freshPlan(page: Page) {
  await page.goto("/plan/local/edit");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("canvas-container")).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name });
const palette = (page: Page) => tab(page, "Attacks");

/**
 * Author a two-object attack with one slot: a void zone that appears, and a
 * marker standing in for whoever the plan says it lands on.
 */
async function authorAttack(page: Page, name: string) {
  await palette(page).click();
  await page.getByTestId("attack-new").click();
  await expect(page.getByTestId("attack-designer-panel")).toBeVisible();

  await page.getByTestId("attack-name").fill(name);

  // The mechanic itself.
  await tab(page, "Shapes").click();
  await page.getByRole("button", { name: "Add Void" }).click();
  await page.getByTestId("prop-x").fill("400");
  await page.getByTestId("prop-y").fill("400");
  await page.getByTestId("add-animation").click();

  // The hole the plan fills.
  await tab(page, "Tokens").click();
  await page.getByRole("button", { name: "Add Marker 1" }).click();
  await page.getByTestId("prop-x").fill("600");
  await page.getByTestId("prop-y").fill("400");
  await page.getByTestId("prop-is-slot").check();
  await page.getByTestId("prop-slot-name").fill("the tank");
  await expect(page.getByTestId("slot-list")).toContainText("the tank");

  await page.getByTestId("attack-save").click();
  await expect(page.getByTestId("canvas-container")).toBeVisible();
}

test("an attack authored in the designer places onto a token and plays", async ({
  page,
}) => {
  await freshPlan(page);
  await authorAttack(page, "Fireball");

  // A token for the attack to land on.
  await tab(page, "Tokens").click();
  await page.getByRole("button", { name: "Add Marker 2" }).click();
  await page.getByTestId("prop-x").fill("900");
  await page.getByTestId("prop-y").fill("500");

  // With the token selected, the attack places; the palette says what it needs.
  await palette(page).click();
  const tile = page.getByRole("button", { name: "Place Fireball" });
  await expect(tile).toContainText("the tank");
  await tile.click();

  // It resolved on the spot: the right rail shows it as one thing.
  await expect(page.getByTestId("attack-card")).toContainText("Fireball");

  // And the timeline shows the whole attack as a single row.
  await page.getByTestId("timeline-toggle").click();
  await expect(page.getByTestId("timeline-dock")).toContainText("Fireball");

  // It plays: the transport runs it like any other animation, and the board
  // locks because it is showing a frame rather than the slide.
  await page.getByTestId("playhead-play").click();
  await expect(page.getByTestId("playback-lock-notice")).toBeVisible();
  await page.getByTestId("playhead-stop").click();
  await expect(page.getByTestId("playback-lock-notice")).toHaveCount(0);
});

test("retiming a placement out and back restores its authored timings exactly", async ({
  page,
}) => {
  await freshPlan(page);
  await authorAttack(page, "Fireball");
  await tab(page, "Tokens").click();
  await page.getByRole("button", { name: "Add Marker 2" }).click();
  await palette(page).click();
  await page.getByRole("button", { name: "Place Fireball" }).click();
  await expect(page.getByTestId("attack-card")).toBeVisible();

  /** Every animation's timing on the slide, straight out of the document. */
  const timings = () =>
    page.evaluate(() => {
      const raw = window.localStorage.getItem("raidplans.plan.local.v1");
      if (!raw) return [];
      const plan = JSON.parse(raw) as {
        slides: { animations: { delayMs: number; durationMs: number }[] }[];
      };
      return (plan.slides[0]?.animations ?? []).map((a) => [
        a.delayMs,
        a.durationMs,
      ]);
    });

  // Wait for the debounced autosave to have written the placement.
  await expect.poll(async () => (await timings()).length).toBeGreaterThan(0);
  const authored = await timings();

  // Stretch it a long way, then bring it back to where it started.
  const speed = page.getByTestId("attack-timescale");
  await speed.fill("340");
  await speed.blur();
  await expect.poll(timings).not.toEqual(authored);

  await speed.fill("100");
  await speed.blur();
  // Exactly, not approximately: the stamp always recomputes from the
  // definition, so a round trip has nowhere to lose a millisecond.
  await expect.poll(timings).toEqual(authored);
});

test("deleting an attack leaves the token its slot was bound to", async ({
  page,
}) => {
  await freshPlan(page);
  await authorAttack(page, "Fireball");
  await tab(page, "Tokens").click();
  await page.getByRole("button", { name: "Add Marker 2" }).click();
  await palette(page).click();
  await page.getByRole("button", { name: "Place Fireball" }).click();

  await expect(page.getByTestId("attack-card")).toBeVisible();
  await page.getByTestId("attack-delete").click();

  await expect(page.getByTestId("attack-card")).toHaveCount(0);
  // The marker the attack was placed on is still on the board.
  await expect(page.getByTestId("object-list")).toContainText("Marker 2");
});
