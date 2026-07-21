import { expect, test } from "@playwright/test";

/**
 * Grouping (plan §18.1). The point of a group is that selecting *any* member
 * selects them all — which is what makes the existing multi-node transformer
 * move them rigidly. So the test sweeps a region containing only one member and
 * asserts the whole group came with it.
 */
test("grouped objects select as one, and ungroup again", async ({ page }) => {
  await page.goto("/plan/local/edit");

  // Two markers, far apart, at known native coordinates.
  await page.getByRole("button", { name: "Add Marker 1" }).click();
  await page.getByTestId("prop-x").fill("100");
  await page.getByTestId("prop-y").fill("100");
  await page.getByRole("button", { name: "Add Marker 2" }).click();
  await page.getByTestId("prop-x").fill("1400");
  await page.getByTestId("prop-y").fill("800");

  const box = (await page.getByTestId("canvas-container").boundingBox())!;
  const sweep = async (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ) => {
    await page.mouse.move(box.x + fromX, box.y + fromY);
    await page.mouse.down();
    await page.mouse.move(box.x + toX, box.y + toY, { steps: 8 });
    await page.mouse.up();
  };
  /** The top-left quadrant holds the first marker only. */
  const sweepFirstOnly = () => sweep(4, 4, box.width * 0.5, box.height * 0.5);

  // Select both and group them.
  await sweep(2, 2, box.width - 2, box.height - 2);
  await expect(page.getByTestId("multi-selection")).toContainText("2 objects");
  await page.getByRole("button", { name: "Group", exact: true }).click();

  // Sweeping only the first marker still selects the pair.
  await sweepFirstOnly();
  await expect(page.getByTestId("multi-selection")).toContainText("2 objects");

  // Ungrouped, the same sweep catches only the one it covers.
  await page.getByRole("button", { name: "Ungroup" }).click();
  await sweepFirstOnly();
  await expect(page.getByTestId("multi-selection")).toHaveCount(0);
  await expect(page.getByTestId("prop-x")).toHaveValue("100");
});
