import { expect, test } from "@playwright/test";
import { signIn } from "../support/auth";

/**
 * The attack designer round-trip (plan §17, stage 4), end-to-end as an admin:
 * open an encounter's attacks, author one in the designer, see it listed, delete
 * it. Requires the signed-in config (`pnpm --filter @raidplan/web test:e2e:auth`).
 */
test("an admin authors an attack, sees it listed, and deletes it", async ({
  page,
}) => {
  await signIn(page);

  await page.goto("/admin");
  await page
    .getByRole("link", { name: /Attacks for/ })
    .first()
    .click();

  // Into the designer (the editor, admin-scoped).
  await page.getByTestId("new-attack").click();
  await expect(page.getByTestId("save-attack")).toBeVisible();
  await expect(page.getByTestId("mode-layout")).toBeVisible();

  // The mechanic shapes are available here, not just icon tokens.
  await page.getByRole("tab", { name: "Shapes" }).click();
  await expect(page.getByRole("button", { name: "Add Soak" })).toBeVisible();
  await page.getByRole("button", { name: "Add Cone" }).click();

  await page.getByTestId("attack-name").fill("Frontal Cone");

  // --- a parameter: the blank a plan fills in (§18.4) ---
  // Declaring one is only half of it; until it's pointed at something inside
  // the attack it does nothing, and the panel has to say so.
  await page.getByLabel("New parameter key").fill("victims");
  await page.getByLabel("New parameter label").fill("Caught by");
  await page.getByRole("button", { name: "Add parameter" }).click();
  await expect(
    page.getByTestId("no-targets-victims-collideWith"),
  ).toBeVisible();

  // Give it something to drive: two animations that fire on contact.
  await page.getByTestId("mode-animate").click();
  await page.getByTestId("add-animation").click();
  await page.getByLabel("Trigger").selectOption("onCollision");
  await page.getByTestId("add-animation").click();
  await page.getByLabel("Trigger").last().selectOption("onCollision");

  // One answer, several places: the parameter supplies *both* animations'
  // collision targets. Each place is named for its position, effect and object,
  // because "move" alone stops meaning anything at two.
  await page
    .getByRole("checkbox", { name: /^Caught by collision targets of: 1\./ })
    .check();
  await page
    .getByRole("checkbox", { name: /^Caught by collision targets of: 2\./ })
    .check();
  await expect(page.getByText(/it drives 2 places/)).toBeVisible();

  await page.getByTestId("save-attack").click();

  // Back on the list, now with the attack.
  await expect(page.getByText("Frontal Cone")).toBeVisible();

  // Reopening shows the binding survived the round trip — the designer is the
  // only place it can be seen, so it had better be there.
  await page.getByRole("link", { name: "Frontal Cone" }).click();
  await expect(page.getByText(/it drives 2 places/)).toBeVisible();

  await page.goBack();
  await page.getByRole("button", { name: "Delete Frontal Cone" }).click();
  await expect(page.getByText("Frontal Cone")).toHaveCount(0);
});
