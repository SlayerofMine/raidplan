import { expect, test, type Page } from "@playwright/test";
import { drawOrder } from "./support/board";

/**
 * Stacking order (plan §2.4 "Order").
 *
 * The whole observable content of z-order is *what is drawn on top of what*, so
 * these read the board's actual draw order back off the canvas rather than
 * checking that a button didn't crash. Konva draws a layer's children front-last,
 * so the last id in `drawOrder` is the one on top.
 */
test.describe("z-order", () => {
  /**
   * Three markers, added in order, and the selection left on the middle one so
   * every button has somewhere to go in both directions.
   */
  async function seedThree(page: Page) {
    await page.goto("/plan/local/edit");
    for (const n of [1, 2, 3]) {
      await page.getByRole("button", { name: `Add Marker ${n}` }).click();
    }
    const stack = await drawOrder(page);
    expect(stack).toHaveLength(3);
    return stack;
  }

  test("a new object is drawn on top of what is already there", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    const before = await drawOrder(page);
    expect(before).toHaveLength(2);

    await page.getByRole("button", { name: "Add Marker 3" }).click();
    const after = await drawOrder(page);

    // Appended to the front of the stack: a token dropped on the board must not
    // arrive hidden behind what was already on it.
    expect(after).toHaveLength(3);
    expect(after.slice(0, 2)).toEqual(before);
    expect(new Set(after).size).toBe(3);
  });

  test("Send to back puts the selection behind everything", async ({
    page,
  }) => {
    const stack = await seedThree(page);
    const selected = stack[stack.length - 1]!; // the newest, still selected

    await page.getByRole("button", { name: "Send to back" }).click();
    const after = await drawOrder(page);

    expect(after[0]).toBe(selected);
    expect(after).toHaveLength(3);
    // Everything else keeps its relative order — it moved one object, not all.
    expect(after.slice(1)).toEqual(stack.slice(0, 2));
  });

  test("Bring to front puts the selection in front of everything", async ({
    page,
  }) => {
    const stack = await seedThree(page);
    const selected = stack[stack.length - 1]!;

    // Send it to the back first, so bringing it forward has work to do.
    await page.getByRole("button", { name: "Send to back" }).click();
    expect((await drawOrder(page))[0]).toBe(selected);

    await page.getByRole("button", { name: "Bring to front" }).click();
    const after = await drawOrder(page);
    expect(after[after.length - 1]).toBe(selected);
    expect(after).toEqual(stack);
  });

  test("Send backward moves one place at a time", async ({ page }) => {
    const stack = await seedThree(page);
    const selected = stack[2]!;

    await page.getByRole("button", { name: "Send backward" }).click();
    // One step: from the top to the middle, not all the way down.
    expect(await drawOrder(page)).toEqual([stack[0], selected, stack[1]]);

    await page.getByRole("button", { name: "Send backward" }).click();
    expect(await drawOrder(page)).toEqual([selected, stack[0], stack[1]]);
  });

  test("Bring forward moves one place at a time", async ({ page }) => {
    const stack = await seedThree(page);
    const selected = stack[2]!;

    await page.getByRole("button", { name: "Send to back" }).click();
    expect(await drawOrder(page)).toEqual([selected, stack[0], stack[1]]);

    await page.getByRole("button", { name: "Bring forward" }).click();
    expect(await drawOrder(page)).toEqual([stack[0], selected, stack[1]]);
  });

  test("stepping past the top or bottom is a no-op, not an error", async ({
    page,
  }) => {
    const stack = await seedThree(page);

    // Already on top: forward twice changes nothing.
    await page.getByRole("button", { name: "Bring forward" }).click();
    await page.getByRole("button", { name: "Bring forward" }).click();
    expect(await drawOrder(page)).toEqual(stack);

    await page.getByRole("button", { name: "Send to back" }).click();
    const atBack = await drawOrder(page);
    await page.getByRole("button", { name: "Send backward" }).click();
    await page.getByRole("button", { name: "Send backward" }).click();
    expect(await drawOrder(page)).toEqual(atBack);
  });

  test("reordering never changes what is on the board", async ({ page }) => {
    const stack = await seedThree(page);
    for (const name of [
      "Send to back",
      "Bring forward",
      "Bring to front",
      "Send backward",
    ]) {
      await page.getByRole("button", { name }).click();
    }
    await expect(page.getByTestId("object-count")).toHaveText("3");
    expect([...(await drawOrder(page))].sort()).toEqual([...stack].sort());
  });

  test("a reorder is undoable", async ({ page }) => {
    const stack = await seedThree(page);
    await page.getByRole("button", { name: "Send to back" }).click();
    expect(await drawOrder(page)).not.toEqual(stack);

    await page.getByRole("button", { name: "Undo" }).click();
    expect(await drawOrder(page)).toEqual(stack);
  });

  test("the drawn order survives a reload", async ({ page }) => {
    await seedThree(page);
    await page.getByRole("button", { name: "Send to back" }).click();
    const reordered = await drawOrder(page);

    await page.waitForTimeout(1600); // autosave is debounced
    await page.reload();
    await expect(page.getByTestId("object-count")).toHaveText("3");

    expect(await drawOrder(page)).toEqual(reordered);
  });
});
