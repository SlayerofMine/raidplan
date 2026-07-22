import { expect, test } from "@playwright/test";
import { signIn } from "../support/auth";

/**
 * An attack anchored to the board (plan §18.15): a frontal that hangs off one
 * of the plan's objects and turns to face another, re-aimed **per frame** — so
 * dragging the target swings the cone round as you drag, with no step change
 * and no re-render in the loop.
 */
test("an anchored frontal follows the board as its target is dragged", async ({
  page,
}) => {
  await signIn(page);

  // --- author: a cone hung off one slot, aimed at another ---
  await page.goto("/admin");
  await page
    .getByRole("link", { name: /Attacks for/ })
    .first()
    .click();
  await page.getByTestId("new-attack").click();
  await page.getByTestId("attack-name").fill("Aimed Frontal");

  await page.getByRole("tab", { name: "Shapes" }).click();
  await page.getByRole("button", { name: "Add Cone" }).click();
  await page.getByRole("button", { name: "Add Slot" }).click();
  await page.getByTestId("prop-name").fill("caster");
  await page.getByTestId("prop-x").fill("250");
  await page.getByTestId("prop-x").blur();
  await page.getByRole("button", { name: "Add Slot" }).click();
  await page.getByTestId("prop-name").fill("target");
  await page.getByTestId("prop-x").fill("750");
  await page.getByTestId("prop-x").blur();

  await page.getByLabel("Anchor origin").selectOption({ label: "caster" });
  await page.getByLabel("Anchor facing").selectOption({ label: "target" });
  await page.getByTestId("save-attack").click();
  await expect(page.getByText("Aimed Frontal")).toBeVisible();

  // --- plan: two tokens fill the slots ---
  await page.goto("/");
  const encounterOption = await page
    .locator('[data-testid="start-choice"] option[value^="encounter:"]')
    .first()
    .getAttribute("value");
  await page.getByTestId("start-choice").selectOption(encounterOption!);
  await page.getByTestId("new-plan").click();
  await expect(page).toHaveURL(/\/plan\/.+\/edit/);

  await page.getByRole("button", { name: /Add Marker 1/ }).click();
  await page.getByRole("button", { name: /Add Marker 2/ }).click();
  await page.keyboard.press("Control+a");

  await page.getByRole("tab", { name: "Attacks" }).click();
  await page.getByRole("button", { name: "Place Aimed Frontal" }).click();
  await expect(page.getByLabel("target is")).toHaveValue(/.+/);

  // --- drag the target: the cone must swing round to keep pointing at it ---
  const canvas = (await page.getByTestId("canvas-container").boundingBox())!;
  const mid = {
    x: canvas.x + canvas.width / 2,
    y: canvas.y + canvas.height / 2,
  };
  const drag = async (to: { x: number; y: number }) => {
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
  };

  // Both markers land in the middle, which leaves the aim undefined — put the
  // target (the one on top) out to the right so the cone points that way.
  await drag({ x: mid.x + 220, y: mid.y });

  /**
   * A strip to the *right* of the caster, where only the cone can be. The
   * target token is parked well clear of it and then dragged straight up, so
   * anything that changes in here is the attack re-aiming and nothing else —
   * including the selection chrome, which sits on whatever was last clicked.
   */
  const strip = {
    x: mid.x + 40,
    y: mid.y - 30,
    width: 100,
    height: 60,
  };
  const rightOfCaster = () => page.screenshot({ clip: strip });
  const aimedRight = await rightOfCaster();

  await page.mouse.move(mid.x + 220, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y - 220, { steps: 12 });
  await page.mouse.up();

  // Pointing up now, so the strip it used to fill is empty. An attack that
  // ignored its anchor would still be lying across it.
  await expect
    .poll(async () => (await rightOfCaster()).equals(aimedRight))
    .toBe(false);
});
