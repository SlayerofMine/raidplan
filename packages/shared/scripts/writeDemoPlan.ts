import { writeFileSync } from "node:fs";
import { buildDemoPlan } from "../src/demoPlan.js";
import { PlanSchema } from "../src/plan.js";

/**
 * Write the feature-demo plan to `docs/demo-plan.json`.
 *
 * Run it from the repo root after adding a shape kind, effect or trigger, so
 * the demo keeps covering everything (`demoPlan.test.ts` fails if it doesn't):
 *
 *   ./apps/api/node_modules/.bin/tsx packages/shared/scripts/writeDemoPlan.ts
 *
 * It borrows the api package's `tsx` so this needs no extra dependency; call
 * the binary directly rather than via `pnpm --filter exec`, which would change
 * the working directory out from under the script path.
 */
const plan = PlanSchema.parse(buildDemoPlan()); // refuse to emit anything invalid
const out = new URL("../../../docs/demo-plan.json", import.meta.url);

writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(
  `demo plan → ${out.pathname} (${plan.objects.length} objects, ` +
    `${plan.steps.length} steps, ` +
    `${plan.steps.reduce((n, s) => n + s.animations.length, 0)} animations)`,
);
