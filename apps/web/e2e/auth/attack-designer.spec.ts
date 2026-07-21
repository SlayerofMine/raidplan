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
  await expect(page.getByRole("button", { name: "Soak" })).toBeVisible();
  await page.getByRole("button", { name: "Cone" }).click();

  await page.getByTestId("attack-name").fill("Frontal Cone");
  await page.getByTestId("save-attack").click();

  // Back on the list, now with the attack.
  await expect(page.getByText("Frontal Cone")).toBeVisible();

  await page.getByRole("button", { name: "Delete Frontal Cone" }).click();
  await expect(page.getByText("Frontal Cone")).toHaveCount(0);
});
