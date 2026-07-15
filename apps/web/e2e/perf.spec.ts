import { expect, test, type Page } from "@playwright/test";

/**
 * The performance gate (plan §3.7 acceptance / §13: "scripted 50-object/4-step
 * scene with an FPS assertion in CI (allow a threshold)").
 *
 * The plan is seeded straight into localStorage rather than clicked together:
 * this measures the *playback engine*, not 50 palette clicks.
 */
const STORAGE_KEY = "raidplans.plan.local.v1";
const OBJECTS = 50;
const STEPS = 4;

/**
 * Headless Chromium renders through software GL (swiftshader), so it is well
 * below a real GPU. The gate is deliberately loose — it exists to catch a
 * *regression* (e.g. re-introducing a React render per frame, which drops this
 * scene by an order of magnitude), not to certify 60fps on this machine.
 */
const MIN_FPS = 24;

function makePlan(objectCount: number, stepCount: number) {
  const objects = Array.from({ length: objectCount }, (_, i) => ({
    id: `o${i}`,
    type: "token" as const,
    iconId: `marker-${(i % 8) + 1}`,
    base: {
      x: 60 + (i % 10) * 145,
      y: 60 + Math.floor(i / 10) * 155,
      w: 64,
      h: 64,
      rotation: 0,
      opacity: 1,
      z: i,
      visible: true,
    },
  }));

  const steps = Array.from({ length: stepCount }, (_, s) => ({
    id: `s${s}`,
    name: `Step ${s + 1}`,
    // Every object moves on every step, and every move is animated: 50
    // concurrent tweens per step is the worst case the plan asks us to hold.
    overrides: Object.fromEntries(
      objects.map((o, i) => [
        o.id,
        {
          x: 60 + ((i + s * 3) % 10) * 145,
          y: 60 + ((Math.floor(i / 10) + s) % 5) * 155,
          rotation: s * 15,
        },
      ]),
    ),
    animations: objects.map((o, i) => ({
      id: `a${s}_${i}`,
      objectId: o.id,
      kind: "motion" as const,
      effect: "move" as const,
      trigger: "onEnter" as const,
      delayMs: 0,
      durationMs: 1500,
      easing: "power2.inOut",
    })),
  }));

  return {
    id: "local",
    title: "Perf scene",
    raid: "",
    background: { assetId: "arena", width: 1600, height: 900 },
    objects,
    steps,
    schemaVersion: 1,
  };
}

async function seed(page: Page) {
  const plan = makePlan(OBJECTS, STEPS);
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY, JSON.stringify(plan)] as const,
  );
}

test(`a ${STEPS}-step, ${OBJECTS}-object plan plays smoothly`, async ({
  page,
}) => {
  await seed(page);
  await page.goto("/p/local");

  await expect(page.getByTestId("viewer-step")).toContainText(`1 / ${STEPS}`);

  await page.getByTestId("play-toggle").click();
  // Let the meter settle over a few sample windows.
  await page.waitForTimeout(1200);

  const fps = Number(
    (await page.getByTestId("fps").textContent())?.split(" ")[0],
  );
  console.log(`${OBJECTS}-object / ${STEPS}-step playback: ${fps} fps`);

  expect(fps).toBeGreaterThanOrEqual(MIN_FPS);
});

test(`every step of the ${OBJECTS}-object plan is navigable`, async ({
  page,
}) => {
  await seed(page);
  await page.goto("/p/local");

  for (let s = 2; s <= STEPS; s++) {
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(page.getByTestId("viewer-step")).toContainText(
      `${s} / ${STEPS}`,
    );
  }
  await expect(page.getByRole("button", { name: "Next step" })).toBeDisabled();
});
