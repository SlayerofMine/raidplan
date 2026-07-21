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
  const encounterName = await page
    .getByLabel(/^Name of /)
    .first()
    .inputValue();
  await page
    .getByRole("link", { name: /Attacks for/ })
    .first()
    .click();
  await page.getByTestId("new-attack").click();
  await page.getByRole("button", { name: "Cone" }).click();
  await page.getByTestId("attack-name").fill("Sweeping Flame");
  await page.getByTestId("save-attack").click();
  await expect(page.getByText("Sweeping Flame")).toBeVisible();

  // --- start a plan on that encounter and place the attack ---
  await page.goto("/");
  await page.getByTestId("start-choice").selectOption({ label: encounterName });
  await page.getByTestId("new-plan").click();
  await expect(page).toHaveURL(/\/plan\/.+\/edit/);

  // Attacks live on a step, so the panel says so until there is one.
  await expect(page.getByTestId("attacks-need-step")).toBeVisible();
  await page.getByTestId("add-step").click();

  await page.getByRole("button", { name: "Place Sweeping Flame" }).click();

  // It's placed on the step, and exposes only its transform and timing.
  await expect(
    page.getByRole("button", { name: "Remove Sweeping Flame" }),
  ).toBeVisible();
  await expect(page.getByLabel("Sweeping Flame rotation")).toHaveValue("0");
});
