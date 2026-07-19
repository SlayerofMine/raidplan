# Feature demo plan

[`demo-plan.json`](./demo-plan.json) is a board that exercises **every** shape
kind, style option, animation effect and trigger in one plan — handy for
eyeballing a change without building a plan by hand.

## Load it

Editor → **Import** → pick `docs/demo-plan.json`. Then hit **Play** to walk the
steps. (Import replaces the current board and clears undo history, so save
anything you care about first.)

## What's on the board

| Row | Contents                                                                                           |
| --- | -------------------------------------------------------------------------------------------------- |
| 1   | One of every shape kind: `rect`, `circle`, `cone`, `line`, `soak`, `voidzone`, `pickup`            |
| 2   | Style variants — scalloped vs round voidzone, striped/solid/hollow fills, outline off, hazard soak |
| 3   | One token per animation effect, animated with that effect in step 1                                |
| 4   | A raid group (both tether line styles), the collision runner + orb, and a click target             |

## What the steps show

1. **Every effect** — all eight effects fire at once, staggered, so you can see
   `appear`/`fade`/`fly`/`disappear`/`move`/`scale`/`pulse`/`blink` side by side.
2. **Trigger chaining** — the same move on three tokens via `onEnter`,
   `withPrevious` and `afterPrevious`, so the sequencing is visible.
3. **Collision pickup** — the runner crosses the orb; the orb is armed with an
   `onCollision` exit animation against it, so it vanishes on contact. Fires
   once; restart the step to re-arm.
4. **Click trigger** — click the "click me" soak (it pulses) or the arrow (it
   fades). `onClick` only fires in the viewer.

## Regenerating

The plan is **built from the enums** in
[`packages/shared/src/demoPlan.ts`](../packages/shared/src/demoPlan.ts), not
hand-written, so adding a shape or effect is picked up automatically.
`demoPlan.test.ts` fails if the demo stops covering everything — when it does,
re-run:

```bash
./apps/api/node_modules/.bin/tsx packages/shared/scripts/writeDemoPlan.ts
```

It validates against `PlanSchema` before writing, so it can never emit an
invalid plan. (It borrows the api package's `tsx`; call the binary directly
rather than through `pnpm --filter exec`, which changes the working directory.)
