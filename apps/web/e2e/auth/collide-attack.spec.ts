import { expect, test } from "@playwright/test";
import { signIn } from "../support/auth";

/**
 * A parameterised collision, end to end (plan §18.4): an attack whose part
 * disappears when it touches whichever of *the plan's* objects the planner
 * nominated.
 *
 * The attack **slides** across its collider rather than starting on top of it,
 * because that is what broke: the collision wrote `visible: false` and the
 * still-running move re-asserted the whole object state a frame later, so the
 * trigger fired and was undone within ~16ms. A stationary attack would pass
 * either way.
 */
test("an attack's onCollision fires against an object the plan nominated", async ({
  page,
}) => {
  await signIn(page);

  // --- author: a cone that vanishes on contact with whoever the plan says ---
  await page.goto("/admin");
  await page
    .getByRole("link", { name: /Attacks for/ })
    .first()
    .click();
  await page.getByTestId("new-attack").click();
  await page.getByRole("tab", { name: "Shapes" }).click();
  await page.getByRole("button", { name: "Add Cone" }).click();
  await page.getByTestId("attack-name").fill("Vanishing Cone");

  await page.getByLabel("New parameter key").fill("victims");
  await page.getByLabel("New parameter label").fill("Caught by");
  await page.getByRole("button", { name: "Add parameter" }).click();

  // A slow slide across the board: the end state is where the move goes.
  await page.getByTestId("mode-animate").click();
  await page.getByTestId("add-animation").click();
  await page.getByTestId("anim-duration").fill("2500");
  await page.getByTestId("prop-x").fill("850");
  await page.getByTestId("prop-x").blur();

  // ...and a disappear on contact with whoever the plan nominates.
  await page.getByTestId("add-animation").click();
  await page.getByTestId("anim-kind").last().selectOption("exit");
  await page.getByTestId("anim-effect").last().selectOption("disappear");
  await page.getByLabel("Trigger").last().selectOption("onCollision");
  await page
    .getByRole("checkbox", { name: /^Caught by collision targets of: 2\./ })
    .check();

  await page.getByTestId("save-attack").click();
  await expect(page.getByText("Vanishing Cone")).toBeVisible();

  // --- plan: place it, give it something to hit, nominate that something ---
  await page.goto("/");
  const encounterOption = await page
    .locator('[data-testid="start-choice"] option[value^="encounter:"]')
    .first()
    .getAttribute("value");
  await page.getByTestId("start-choice").selectOption(encounterOption!);
  await page.getByTestId("new-plan").click();
  await expect(page).toHaveURL(/\/plan\/.+\/edit/);

  await page.getByRole("tab", { name: "Attacks" }).click();
  await page.getByRole("button", { name: "Place Vanishing Cone" }).click();

  // Both land in the middle of the board, so they overlap from the start.
  await page.getByRole("tab", { name: "Shapes" }).click();
  await page.getByRole("button", { name: "Add Soak" }).click();

  await page.getByRole("checkbox", { name: /^Caught by: / }).check();

  const saved = page.waitForResponse(
    (r) =>
      r.url().includes("saveDoc") &&
      (r.request().postData() ?? "").includes('"victims"'),
  );
  await saved;

  // --- play: the cone shows, meets the soak, and goes ---
  await page.getByTestId("open-viewer").click();
  await expect(page.getByTestId("viewer-step")).toContainText("1 / 1");

  const board = page.getByTestId("viewer-canvas");
  await expect(board).toBeVisible();
  const before = await board.screenshot();

  await page.getByTestId("play-toggle").click();

  // It slides in...
  await expect
    .poll(async () => (await board.screenshot()).equals(before))
    .toBe(false);

  // ...meets the soak, and the collision takes it off for good, leaving the
  // board as it started. With the trigger undone a frame later, the cone
  // finishes its slide and sits there instead.
  await expect
    .poll(async () => (await board.screenshot()).equals(before), {
      timeout: 15_000,
    })
    .toBe(true);

  // Watching it again looks the same: play on a finished step starts it over,
  // so the pickup is re-armed without touching rewind. (The cone vanishes
  // before the slide is over, so wait for the transport itself to finish —
  // clicking mid-run would pause, not replay.)
  await expect(page.getByTestId("play-toggle")).toHaveAttribute(
    "aria-label",
    "Play",
  );
  await page.getByTestId("play-toggle").click();
  await expect
    .poll(async () => (await board.screenshot()).equals(before))
    .toBe(false);
  await expect
    .poll(async () => (await board.screenshot()).equals(before), {
      timeout: 15_000,
    })
    .toBe(true);
});
