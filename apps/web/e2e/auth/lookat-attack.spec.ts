import { expect, test } from "@playwright/test";
import { signIn } from "../support/auth";

/** Just enough of a Konva node to read its id and rotation from the page. */
interface KonvaNodeLike {
  id: () => string;
  rotation: () => number;
}

/**
 * A look-at, end to end (plan §18.16): a part of the attack kept turned towards
 * another part as that part's own animation flies it across.
 *
 * No plan object is involved and nothing outside the attack moves — the arrow
 * re-aims purely because the orb is animating, which is exactly what tells this
 * apart from an anchor.
 */
test("an internal indicator turns to follow the attack's own moving part", async ({
  page,
}) => {
  await signIn(page);

  // --- author: an arrow that keeps facing an orb, and an orb that flies right ---
  await page.goto("/admin");
  await page
    .getByRole("link", { name: /Attacks for/ })
    .first()
    .click();
  await page.getByTestId("new-attack").click();
  await page.getByTestId("attack-name").fill("Homing Arrow");

  await page.getByRole("tab", { name: "Shapes" }).click();
  // The arrow, drawn at the middle pointing right at the orb.
  await page.getByRole("button", { name: "Add Beam" }).click();
  await page.getByTestId("prop-name").fill("arrow");
  // The orb, off to the right.
  await page.getByRole("button", { name: "Add Soak" }).click();
  await page.getByTestId("prop-name").fill("orb");
  await page.getByTestId("prop-x").fill("800");
  await page.getByTestId("prop-x").blur();

  // The orb flies down over the step.
  await page.getByTestId("mode-animate").click();
  await page.getByTestId("add-animation").click();
  await page.getByTestId("anim-duration").fill("2000");
  await page.getByTestId("prop-y").fill("850");
  await page.getByTestId("prop-y").blur();

  // Declare the look-at: the arrow faces the orb.
  await page.getByRole("button", { name: "Add look-at" }).click();
  await page.getByLabel("Look-at 0 aimer").selectOption({ label: "arrow" });
  await page.getByLabel("Look-at 0 target").selectOption({ label: "orb" });

  await page.getByTestId("save-attack").click();
  await expect(page.getByText("Homing Arrow")).toBeVisible();

  // --- plan: place it, no slots to fill (nothing is external) ---
  await page.goto("/");
  const encounterOption = await page
    .locator('[data-testid="start-choice"] option[value^="encounter:"]')
    .first()
    .getAttribute("value");
  await page.getByTestId("start-choice").selectOption(encounterOption!);
  await page.getByTestId("new-plan").click();
  await expect(page).toHaveURL(/\/plan\/.+\/edit/);

  await page.getByRole("tab", { name: "Attacks" }).click();
  await page.getByRole("button", { name: "Place Homing Arrow" }).click();

  const saved = page.waitForResponse(
    (r) =>
      r.url().includes("saveDoc") &&
      (r.request().postData() ?? "").includes('"attacks":[{'),
  );
  await saved;

  // --- play: the arrow's own rotation must change as the orb flies ---
  await page.getByTestId("open-viewer").click();
  await expect(page.getByTestId("viewer-canvas")).toBeVisible();

  // The arrow re-aims by having its *rotation* written every frame, so read it
  // straight off the drawn node rather than inferring it from pixels — the orb
  // moving would change pixels on its own, the arrow's angle would not.
  const arrowAngle = () =>
    page.evaluate(() => {
      const konva = (
        window as unknown as {
          Konva?: { stages: { find: (s: string) => KonvaNodeLike[] }[] };
        }
      ).Konva;
      const stage = konva?.stages?.[0];
      if (!stage) return null;
      const node = stage
        .find("Group")
        .find((n) => /::/.test(n.id()) && n.rotation() !== 0);
      return node ? node.rotation() : 0;
    });

  await page.getByTestId("play-toggle").click();
  await page.waitForTimeout(300);
  const early = await arrowAngle();
  await page.waitForTimeout(900);
  const later = await arrowAngle();

  expect(early).not.toBeNull();
  expect(Math.abs((later ?? 0) - (early ?? 0))).toBeGreaterThan(5);
});
