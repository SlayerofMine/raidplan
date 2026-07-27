import { expect, test, type Page } from "@playwright/test";
import { boardNodes } from "./support/board";

/**
 * Keyboard nudging (plan §2.7) — arrow keys move the selection.
 *
 * Three rules decide the distance, and they interact, so each is pinned
 * separately: a bare arrow moves one native pixel, Shift moves ten, and with
 * Snap on the step becomes one grid cell and Shift stops mattering. Everything
 * here reads the result back off the properties panel, which is the same number
 * the planner is looking at.
 */
test.describe("keyboard nudge", () => {
  const GRID = 40;

  /** One marker at a known native position, selected, with focus off the panel. */
  async function seed(page: Page, x = 410, y = 330) {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill(String(x));
    await page.getByTestId("prop-y").fill(String(y));
    // Hotkeys are deliberately ignored while a field has focus. Blur rather
    // than clicking the board, which would clear the selection we need.
    await page.getByTestId("prop-y").blur();
    return { x, y };
  }

  const position = async (page: Page) => ({
    x: Number(await page.getByTestId("prop-x").inputValue()),
    y: Number(await page.getByTestId("prop-y").inputValue()),
  });

  for (const [key, dx, dy] of [
    ["ArrowLeft", -1, 0],
    ["ArrowRight", 1, 0],
    ["ArrowUp", 0, -1],
    ["ArrowDown", 0, 1],
  ] as const) {
    test(`${key} moves one pixel, and only on its own axis`, async ({
      page,
    }) => {
      const start = await seed(page);
      await page.keyboard.press(key);
      expect(await position(page)).toEqual({
        x: start.x + dx,
        y: start.y + dy,
      });
    });

    test(`Shift+${key} moves ten pixels`, async ({ page }) => {
      const start = await seed(page);
      await page.keyboard.press(`Shift+${key}`);
      expect(await position(page)).toEqual({
        x: start.x + dx * 10,
        y: start.y + dy * 10,
      });
    });
  }

  test("nudges accumulate one press at a time", async ({ page }) => {
    const start = await seed(page);
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    expect(await position(page)).toEqual({ x: start.x + 5, y: start.y });
  });

  test("with Snap on, an arrow steps a whole grid cell", async ({ page }) => {
    const start = await seed(page);
    await page.getByTestId("snap-toggle").check();
    await page.getByTestId("snap-toggle").blur();

    await page.keyboard.press("ArrowRight");
    // A step, not a quantize: the object keeps its offset from the gridlines
    // (410 is not a multiple of 40) and moves a full cell.
    expect(await position(page)).toEqual({ x: start.x + GRID, y: start.y });
  });

  test("with Snap on, Shift changes nothing — the cell is already the step", async ({
    page,
  }) => {
    const start = await seed(page);
    await page.getByTestId("snap-toggle").check();
    await page.getByTestId("snap-toggle").blur();

    await page.keyboard.press("Shift+ArrowDown");
    expect(await position(page)).toEqual({ x: start.x, y: start.y + GRID });
  });

  test("Snap is off to begin with", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await expect(page.getByTestId("snap-toggle")).not.toBeChecked();
  });

  test("a locked object refuses to be nudged", async ({ page }) => {
    const start = await seed(page);
    await page.getByTestId("prop-locked").check();
    await page.getByTestId("prop-locked").blur();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    expect(await position(page)).toEqual(start);
  });

  test("with nothing selected, arrows move nothing", async ({ page }) => {
    const start = await seed(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("no-selection")).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");

    // Select-all brings the one object back into the panel, unmoved.
    await page.keyboard.press("Control+a");
    expect(await position(page)).toEqual(start);
  });

  test("arrows typed into a field edit the text, not the board", async ({
    page,
  }) => {
    const start = await seed(page);
    // The title field is the classic case: an author moving the caret must not
    // be dragging their tokens around behind the panel.
    await page.getByTestId("plan-title").click();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    expect(await position(page)).toEqual(start);
  });

  test("a nudge moves every object in a multi-selection", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("200");
    await page.getByTestId("prop-y").fill("200");
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByTestId("prop-x").fill("900");
    await page.getByTestId("prop-y").fill("600");
    await page.getByTestId("prop-y").blur();

    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("multi-selection")).toContainText(
      "2 objects",
    );

    // The panel shows no coordinates for a multi-selection, so read the board.
    const before = await boardNodes(page);
    expect(before).toHaveLength(2);

    await page.keyboard.press("Shift+ArrowRight");

    const after = await boardNodes(page);
    for (const node of before) {
      const moved = after.find((n) => n.id === node.id)!;
      expect(moved.x).toBeCloseTo(node.x + 10, 5);
      expect(moved.y).toBeCloseTo(node.y, 5);
    }
  });

  test("a nudge is undoable", async ({ page }) => {
    const start = await seed(page);
    await page.keyboard.press("Shift+ArrowRight");
    expect((await position(page)).x).toBe(start.x + 10);

    await page.getByRole("button", { name: "Undo" }).click();
    expect(await position(page)).toEqual(start);
  });
});
