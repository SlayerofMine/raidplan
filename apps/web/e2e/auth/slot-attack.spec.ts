import { expect, test } from "@playwright/test";
import { signIn } from "../support/auth";

/**
 * A **placeholder** end to end (plan §18.14): a definition with a hole in it,
 * filled by one of the using plan's own objects.
 *
 * This is the thing a definition could not express before — every internal
 * reference was namespaced to the instance, so a tether had to have both ends
 * inside the attack. Now one end can be the tank.
 */
test("an attack tethers itself to an object the plan puts in its slot", async ({
  page,
}) => {
  await signIn(page);

  // --- author: an orb leashed to whoever the plan nominates ---
  await page.goto("/admin");
  await page
    .getByRole("link", { name: /Attacks for/ })
    .first()
    .click();
  await page.getByTestId("new-attack").click();
  await page.getByTestId("attack-name").fill("Leash");

  await page.getByRole("tab", { name: "Shapes" }).click();
  await page.getByRole("button", { name: "Add Soak" }).click();
  await page.getByTestId("prop-name").fill("orb");
  await page.getByRole("button", { name: "Add Slot" }).click();
  await page.getByTestId("prop-name").fill("victim");
  await page.getByTestId("prop-x").fill("700");
  await page.getByTestId("prop-x").blur();

  // Tie the two together: one end the attack's own, one end the hole.
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "Tether" }).click();
  await page.getByTestId("save-attack").click();
  await expect(page.getByText("Leash")).toBeVisible();

  // --- plan: it can't be placed until something fills the hole ---
  await page.goto("/");
  const encounterOption = await page
    .locator('[data-testid="start-choice"] option[value^="encounter:"]')
    .first()
    .getAttribute("value");
  await page.getByTestId("start-choice").selectOption(encounterOption!);
  await page.getByTestId("new-plan").click();
  await expect(page).toHaveURL(/\/plan\/.+\/edit/);

  await page.getByRole("tab", { name: "Attacks" }).click();
  const place = page.getByRole("button", { name: "Place Leash" });
  // Nothing selected, so there is nothing to put in the hole.
  await expect(place).toBeDisabled();

  // Give the plan a token and select it; now the attack has somewhere to hook.
  await page.getByRole("tab", { name: "Tokens" }).click();
  await page.getByRole("button", { name: /Add Marker 1/ }).click();
  await page.getByRole("tab", { name: "Attacks" }).click();
  await expect(place).toBeEnabled();
  await place.click();

  // The slot is filled, and says so in a way you can change later.
  await expect(page.getByLabel("victim is")).toHaveValue(/.+/);
  await expect(
    page.getByRole("button", { name: "Remove Leash" }),
  ).toBeVisible();
});
