import { expect, test } from "@playwright/test";
import { signIn } from "../support/auth";

/**
 * Protected flows, exercised end-to-end without Discord (plan §13). Requires the
 * signed-in config: `pnpm --filter @raidplan/web test:e2e:auth`.
 */
test.describe("signed-in", () => {
  test("dev-login lands on a signed-in home page", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await expect(page.getByTestId("sign-out")).toBeVisible();
    // The e2e user is an admin, so the admin link shows.
    await expect(page.getByTestId("admin-link")).toBeVisible();
  });

  test("an admin can open the encounter admin panel", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Encounter admin" }),
    ).toBeVisible();
    await expect(page.getByTestId("admin-forbidden")).toHaveCount(0);
  });

  test("a signed-in user creates a plan and lands in the editor", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/");
    await page.getByTestId("new-plan").click();
    await expect(page).toHaveURL(/\/plan\/.+\/edit/);
  });
});
