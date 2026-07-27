import { expect, test, type Page } from "@playwright/test";

/**
 * The object ids the selection `Transformer` is currently attached to.
 *
 * Reaching into Konva is the only way to assert on canvas chrome: the handles
 * are pixels, not DOM, and `Konva.stages` is the library's own registry of live
 * stages. Which is worth the reach — selection has *two* halves that can drift
 * apart, the store's `selectedIds` (what the properties panel reads) and the
 * nodes the transformer is attached to, and only the second is what a planner
 * sees round the thing they just added.
 */
const attachedIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    interface NodeLike {
      id(): string;
    }
    interface StageLike {
      findOne(selector: string): { nodes(): NodeLike[] } | undefined;
    }
    const konva = (window as unknown as { Konva?: { stages: StageLike[] } })
      .Konva;
    const stage = konva?.stages.at(-1);
    return (
      stage
        ?.findOne("Transformer")
        ?.nodes()
        .map((n) => n.id()) ?? []
    );
  });

test.describe("selection & movement", () => {
  test("adding an icon selects it and fills the properties panel", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await expect(page.getByTestId("no-selection")).toBeVisible();

    await page
      .getByRole("button", { name: /^Add Marker/ })
      .first()
      .click();
    await expect(page.getByTestId("properties")).toBeVisible();
    await expect(page.getByTestId("no-selection")).toHaveCount(0);
  });

  test("a newly added object comes up with handles round it", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");

    // Adding writes the object and selects it in one store update, so this is
    // the case where the transformer can be asked to attach to a node the
    // canvas has not created yet — and it used to, silently, leaving a selected
    // object with no handles that no amount of clicking would bring back (the
    // click is a no-op: the thing is already selected).
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await expect(page.getByTestId("properties")).toBeVisible();
    await expect.poll(() => attachedIds(page)).toHaveLength(1);
    const [first] = await attachedIds(page);

    // A second add moves the handles on to the new object rather than leaving
    // them behind on the first.
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await expect.poll(() => attachedIds(page)).toEqual([expect.any(String)]);
    expect((await attachedIds(page))[0]).not.toBe(first);

    await page.keyboard.press("Escape");
    await expect.poll(() => attachedIds(page)).toEqual([]);
  });

  test("Escape clears the selection", async ({ page }) => {
    await page.goto("/plan/local/edit");
    await page
      .getByRole("button", { name: /^Add Marker/ })
      .first()
      .click();
    await expect(page.getByTestId("properties")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("no-selection")).toBeVisible();
  });

  test("dragging on empty canvas rubber-band selects the swept tokens", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");

    // Spread three tokens across known native coordinates.
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("100");
    await page.getByTestId("prop-y").fill("100");
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByTestId("prop-x").fill("300");
    await page.getByTestId("prop-y").fill("100");
    await page.getByRole("button", { name: "Add Marker 3" }).click();
    await page.getByTestId("prop-x").fill("1400");
    await page.getByTestId("prop-y").fill("800");

    // Sweep the top-left quadrant: should catch the first two, not the third.
    // The sweep is non-additive, so it replaces whatever was selected.
    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
      steps: 8,
    });
    await page.mouse.up();

    await expect(page.getByTestId("multi-selection")).toContainText(
      "2 objects",
    );
  });

  test("a click on empty canvas clears the selection without sweeping", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await expect(page.getByTestId("properties")).toBeVisible();

    // A press with no drag must not select everything — it just deselects.
    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    await page.mouse.click(box.x + 6, box.y + 6);
    await expect(page.getByTestId("no-selection")).toBeVisible();
  });

  test("shift-sweeping adds to the existing selection", async ({ page }) => {
    await page.goto("/plan/local/edit");

    await page.getByRole("button", { name: "Add Marker 1" }).click();
    await page.getByTestId("prop-x").fill("100");
    await page.getByTestId("prop-y").fill("100");
    await page.getByRole("button", { name: "Add Marker 2" }).click();
    await page.getByTestId("prop-x").fill("1400");
    await page.getByTestId("prop-y").fill("700");

    // Keep marker 2 selected, then shift-sweep marker 1's corner.
    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    await page.keyboard.down("Shift");
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35, {
      steps: 6,
    });
    await page.mouse.up();
    await page.keyboard.up("Shift");

    await expect(page.getByTestId("multi-selection")).toContainText(
      "2 objects",
    );
  });

  test("dragging a token on the canvas updates its native position", async ({
    page,
  }) => {
    await page.goto("/plan/local/edit");
    // A palette click drops the token at the centre of the current view, i.e.
    // the centre of the canvas container — so that's where we grab it.
    await page
      .getByRole("button", { name: /^Add Marker/ })
      .first()
      .click();

    const x = page.getByTestId("prop-x");
    const y = page.getByTestId("prop-y");
    const x0 = Number(await x.inputValue());
    const y0 = Number(await y.inputValue());

    const box = (await page.getByTestId("canvas-container").boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Clear the selection first: a selected token shows its origin crosshair
    // right at its centre (plan §18.17), and grabbing dead-centre would drag the
    // origin, not the token. Deselected, the same press lands on the body, which
    // selects and drags it — the gesture a planner actually makes.
    await page.mouse.click(box.x + 6, box.y + 6);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 80, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => Number(await x.inputValue()))
      .toBeGreaterThan(x0);
    await expect
      .poll(async () => Number(await y.inputValue()))
      .toBeGreaterThan(y0);
  });
});
