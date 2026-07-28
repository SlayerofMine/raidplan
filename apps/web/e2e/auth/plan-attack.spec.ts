import { expect, test } from "@playwright/test";
import { planReady, signIn } from "../support/auth";

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
  await planReady(page);
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

/**
 * "Save as attack" (plan §19.3): the assembly a planner has already made *is*
 * the attack, so the tool reads it rather than asking them to redraw it in the
 * designer. This is what §18.1's groups were for.
 */
test("a group becomes a reusable attack, and the originals stay put", async ({
  page,
}) => {
  await signIn(page, "e2e-planner", "E2E Planner");

  await page.goto("/");
  await page.getByTestId("new-plan").click();
  await expect(page).toHaveURL(/\/plan\/.+\/edit/);
  await planReady(page);
  const planUrl = page.url();

  // Two markers, grouped — the "four circles dragged into a cone" case.
  await page.getByRole("button", { name: "Add Marker 1" }).click();
  await page.getByTestId("prop-x").fill("200");
  await page.getByTestId("prop-y").fill("200");
  await page.getByRole("button", { name: "Add Marker 2" }).click();
  await page.getByTestId("prop-x").fill("400");
  await page.getByTestId("prop-y").fill("200");

  const box = (await page.getByTestId("canvas-container").boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByTestId("multi-selection")).toContainText("2 objects");
  await page.getByRole("button", { name: "Group", exact: true }).click();

  // The plan's own autosave is debounced; let it land before reloading below,
  // or the reload would be testing the autosave rather than this feature.
  const planSaved = page.waitForResponse((r) => r.url().includes("saveDoc"));

  // --- the assembly becomes a definition ---
  await page.getByRole("button", { name: "Save as attack" }).click();
  await page.getByTestId("new-attack-name").fill("Twin Markers");
  await page.getByRole("button", { name: "Save attack" }).click();
  await expect(page.getByText(/Saved “Twin Markers”/)).toBeVisible();

  // --- the author stays where they were, and the originals are untouched:
  //     saving is not converting ---
  await expect(page.getByTestId("multi-selection")).toContainText("2 objects");
  await planSaved;
  await page.goto(planUrl);
  await expect(page.getByTestId("object-count")).toContainText("2");

  await page.getByRole("tab", { name: "Attacks" }).click();
  await expect(
    page
      .getByTestId("plan-attacks")
      .getByRole("button", { name: "Place Twin Markers" }),
  ).toBeVisible();
});
