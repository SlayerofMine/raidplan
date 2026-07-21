import { expect, test } from "@playwright/test";
import { signIn } from "../support/auth";

/**
 * The whole epic end-to-end (plan §17): an admin authors an attack for an
 * encounter, a planner starts a plan from that encounter, and places the attack
 * on a step. Requires the signed-in config (`test:e2e:auth`).
 */
test("author an attack, then place it in a plan seeded from its encounter", async ({
  page,
}) => {
  await signIn(page);

  // --- author the attack (admin) ---
  await page.goto("/admin");
  await page
    .getByRole("link", { name: /Attacks for/ })
    .first()
    .click();
  await page.getByTestId("new-attack").click();
  await page.getByRole("tab", { name: "Shapes" }).click();
  await page.getByRole("button", { name: "Add Cone" }).click();
  await page.getByTestId("attack-name").fill("Sweeping Flame");
  await page.getByTestId("save-attack").click();
  await expect(page.getByText("Sweeping Flame")).toBeVisible();

  // --- start a plan on that encounter and place the attack ---
  await page.goto("/");
  // Seeded encounters share their names with the bundled maps, so pick by value:
  // only encounter options carry the `encounter:` prefix.
  const encounterOption = await page
    .locator('[data-testid="start-choice"] option[value^="encounter:"]')
    .first()
    .getAttribute("value");
  await page.getByTestId("start-choice").selectOption(encounterOption!);
  await page.getByTestId("new-plan").click();
  await expect(page).toHaveURL(/\/plan\/.+\/edit/);

  // The library lives in the palette, beside tokens and shapes.
  await page.getByRole("tab", { name: "Attacks" }).click();
  // Attacks live on a step, so it says so until there is one.
  await expect(page.getByTestId("attacks-need-step")).toBeVisible();
  await page.getByTestId("add-step").click();

  await page.getByRole("button", { name: "Place Sweeping Flame" }).click();

  // It's placed on the step, and exposes only its timing here — position, size
  // and rotation are edited on the canvas (plan §18.3).
  await expect(
    page.getByRole("button", { name: "Remove Sweeping Flame" }),
  ).toBeVisible();
  await expect(page.getByLabel("Sweeping Flame start")).toHaveValue("0");
  await expect(page.getByLabel("Sweeping Flame rotation")).toHaveCount(0);

  // --- it's a canvas citizen: clickable there, and Delete removes it ---
  const canvas = (await page.getByTestId("canvas-container").boundingBox())!;
  // Placed at the middle of the board, which "fit" puts at the canvas centre.
  await page.mouse.click(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await expect(page.getByTestId("placed-attack")).toHaveAttribute(
    "data-selected",
    "true",
  );

  await page.keyboard.press("Delete");
  await expect(page.getByTestId("no-placed")).toBeVisible();
});
