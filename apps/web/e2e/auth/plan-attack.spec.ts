import { expect, test } from "@playwright/test";
import { signIn } from "../support/auth";

/**
 * Authoring an attack **without being an admin** (plan §19.3), end-to-end: a
 * plain signed-in planner draws one inside their own plan, and places it.
 *
 * This is the whole point of §19, so it is asserted as a non-admin from the
 * first line — `e2e-planner` is deliberately *not* on the allowlist
 * (`playwright.auth.config.ts` lists `e2e-admin`). If the gate ever creeps back
 * onto the act of authoring rather than onto the encounter's library, this fails
 * at the designer's door.
 *
 * Requires the signed-in config (`pnpm --filter @raidplan/web test:e2e:auth`).
 */
test("a planner who is not an admin draws an attack in their own plan", async ({
  page,
}) => {
  await signIn(page, "e2e-planner", "E2E Planner");

  // The admin panel is not theirs — the library stays curated (§19.1).
  await page.goto("/admin");
  await expect(page.getByTestId("new-plan")).toHaveCount(0);

  // Their own plan, from the home page's default start.
  await page.goto("/");
  await page.getByTestId("new-plan").click();
  await expect(page).toHaveURL(/\/plan\/.+\/edit/);
  const planUrl = page.url();

  // The palette has a section of its own — the one a planner may write to
  // (§19.4), beside whatever the encounter's curated library holds.
  await page.getByRole("tab", { name: "Attacks" }).click();
  await expect(page.getByTestId("plan-attacks")).toBeVisible();

  // --- into the designer, from the plan rather than from /admin ---
  await page.getByTestId("new-plan-attack").click();
  await expect(page.getByTestId("save-attack")).toBeVisible();

  await page.getByRole("tab", { name: "Shapes" }).click();
  await page.getByRole("button", { name: "Add Cone" }).click();
  await page.getByTestId("attack-name").fill("My Cone");
  await page.getByTestId("save-attack").click();

  // Back is the plan it belongs to, not an admin list.
  await expect(page).toHaveURL(planUrl);

  // --- it is in *this plan's* section, and placeable ---
  await page.getByRole("tab", { name: "Attacks" }).click();
  const own = page.getByTestId("plan-attacks");
  await expect(
    own.getByRole("button", { name: "Place My Cone" }),
  ).toBeVisible();

  await own.getByRole("button", { name: "Place My Cone" }).click();
  await expect(
    page.getByRole("button", { name: "Remove My Cone" }),
  ).toBeVisible();
});
