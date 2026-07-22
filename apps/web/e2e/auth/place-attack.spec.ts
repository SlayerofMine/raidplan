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
  // A parameter: the blank this definition leaves for whichever plan uses it.
  await page.getByLabel("New parameter key").fill("victims");
  await page.getByLabel("New parameter label").fill("Caught by");
  await page.getByRole("button", { name: "Add parameter" }).click();
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

  // The library lives in the palette, beside tokens and shapes. Placing works
  // from the base layout — where you lay the board out — and the attack fires
  // on step 1, which is created for it.
  await page.getByRole("tab", { name: "Attacks" }).click();
  await expect(page.getByTestId("step-base")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Autosave is debounced, so listen for the save that carries the attack
  // itself before trusting the viewer to have it.
  const attackSaved = page.waitForResponse(
    (r) =>
      r.url().includes("saveDoc") &&
      (r.request().postData() ?? "").includes('"attacks":[{'),
  );
  await page.getByRole("button", { name: "Place Sweeping Flame" }).click();

  // It's on the board. Every value has one home now, so the panel itself
  // carries no number boxes at all (§18.3/§18.6) — only which step fires it.
  await expect(
    page.getByRole("button", { name: "Remove Sweeping Flame" }),
  ).toBeVisible();
  await expect(page.getByLabel("Sweeping Flame rotation")).toHaveCount(0);
  await expect(page.getByLabel("Sweeping Flame fires on")).toHaveValue(/.+/);

  // The definition's parameter surfaces here as a tick-list of *this plan's*
  // objects — the thing a reusable definition can never know for itself.
  await page.getByRole("tab", { name: "Shapes" }).click();
  await page.getByRole("button", { name: "Add Soak" }).click();
  await expect(
    page.getByRole("checkbox", { name: /^Caught by: / }),
  ).toHaveCount(1);

  // When within that step is a draggable bar on the timeline.
  await page.getByTestId("step-0").click();
  await page.getByTestId("timeline-toggle").click();
  await expect(
    page.getByRole("button", { name: /Sweeping Flame · starts 0ms/ }),
  ).toBeVisible();

  // --- and it is actually on screen while its step plays (§17's whole point) ---
  const planUrl = page.url();
  await attackSaved;
  await page.getByTestId("open-viewer").click();
  await expect(page.getByTestId("viewer-step")).toContainText("1 / 1");

  // Nothing else on this plan moves, so the board changing *is* the attack
  // arriving. Asserted on real pixels rather than on the scene graph: an attack
  // that expands, resolves and animates but never gets drawn is the bug.
  const board = page.getByTestId("viewer-canvas");
  await expect(board).toBeVisible();
  const before = await board.screenshot();

  await page.getByTestId("play-toggle").click();
  await expect
    .poll(async () => (await board.screenshot()).equals(before))
    .toBe(false);

  // --- it's a canvas citizen: clickable there, and Delete removes it ---
  // Loading a plan is itself a store change, so it schedules an autosave; wait
  // that out, or its pending write would mask what the removal below saves.
  const loadSaved = page.waitForResponse((r) => r.url().includes("saveDoc"));
  await page.goto(planUrl);
  // A reload lands on the base layout — which is a fine place to grab an
  // attack, because that's where the board is laid out.
  // The name only resolves once the definitions are fetched, which is also when
  // the attack becomes grabbable on the canvas.
  await expect(
    page.getByRole("button", { name: "Select Sweeping Flame" }),
  ).toBeVisible();
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

  // Selecting it gives the properties panel, same as any other selection: the
  // canvas places it roughly, this says exactly.
  await page.getByTestId("attack-prop-x").fill("120");
  await page.getByTestId("attack-prop-name").fill("north cone");
  await expect(
    page.getByRole("button", { name: "Select north cone" }),
  ).toBeVisible();
  // Out of the text field, or Delete below would edit the name instead.
  await page.getByTestId("attack-prop-name").blur();

  // Removing it is the only edit this plan gets, so the save that carries an
  // empty attack list proves an attack-only change is a document change. (It
  // wasn't: the autosaves compared a hand-written list of slices that had never
  // heard of `attacks`, so a plan made of one attack never saved at all.)
  await loadSaved;
  const removalSaved = page.waitForResponse(
    (r) =>
      r.url().includes("saveDoc") &&
      (r.request().postData() ?? "").includes('"attacks":[]'),
  );
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("no-placed")).toBeVisible();
  await removalSaved;

  // ...and it stays gone.
  await page.goto(planUrl);
  await expect(page.getByTestId("no-placed")).toBeVisible();
});
