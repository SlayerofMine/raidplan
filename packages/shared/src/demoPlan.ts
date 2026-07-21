import { ANIM_EFFECTS, SHAPE_KINDS, type AnimEffect } from "./effects.js";
import {
  SCHEMA_VERSION,
  type Anim,
  type Plan,
  type PlanObject,
} from "./plan.js";
import type { ObjectStyle } from "./mechanics.js";

/**
 * A feature-demo plan: every shape kind, every style option, every animation
 * effect and every trigger, on one board.
 *
 * Built as code rather than hand-written JSON so it is **derived from the
 * enums** — add a shape kind or an effect and re-running the generator covers
 * it automatically, with `demoPlan.test.ts` failing if anything is left out.
 * The committed artifact lives at `docs/demo-plan.json`; import it with the
 * editor's Import button.
 *
 * Deliberately *not* exported from the package index: it's a dev fixture and
 * has no business in the app bundle.
 */

const BOARD = { assetId: "arena", width: 1600, height: 900 } as const;

/** Sizes that read well on the board, per shape. */
const SHAPE_SIZE: Record<string, { w: number; h: number }> = {
  line: { w: 190, h: 54 },
  pickup: { w: 90, h: 90 },
};
const DEFAULT_SHAPE_SIZE = { w: 140, h: 140 };

let z = 0;

function object(params: {
  id: string;
  type: PlanObject["type"];
  x: number;
  y: number;
  w: number;
  h: number;
  iconId?: string;
  shape?: PlanObject["shape"];
  style?: ObjectStyle;
  name?: string;
  label?: string;
  tint?: string;
  fromId?: string;
  toId?: string;
}): PlanObject {
  const { id, type, x, y, w, h, iconId, shape, style, name, label, tint } =
    params;
  return {
    id,
    type,
    ...(iconId ? { iconId } : {}),
    ...(shape ? { shape } : {}),
    ...(style ? { style } : {}),
    ...(params.fromId ? { fromId: params.fromId } : {}),
    ...(params.toId ? { toId: params.toId } : {}),
    base: {
      x,
      y,
      w,
      h,
      rotation: 0,
      opacity: 1,
      z: z++,
      visible: true,
      ...(name ? { name } : {}),
      ...(label ? { label } : {}),
      ...(tint ? { tint } : {}),
    },
  };
}

function anim(params: {
  id: string;
  objectId: string;
  kind: Anim["kind"];
  effect: AnimEffect;
  trigger: Anim["trigger"];
  durationMs?: number;
  delayMs?: number;
  easing?: string;
  collideWith?: string[];
  params?: Anim["params"];
}): Anim {
  return {
    id: params.id,
    objectId: params.objectId,
    kind: params.kind,
    effect: params.effect,
    trigger: params.trigger,
    delayMs: params.delayMs ?? 0,
    durationMs: params.durationMs ?? 600,
    easing: params.easing ?? "power2.out",
    ...(params.collideWith ? { collideWith: params.collideWith } : {}),
    ...(params.params ? { params: params.params } : {}),
  };
}

/** The animation family each effect belongs to, so all four kinds appear. */
const EFFECT_KIND: Record<AnimEffect, Anim["kind"]> = {
  appear: "entrance",
  fade: "entrance",
  fly: "entrance",
  disappear: "exit",
  move: "motion",
  scale: "emphasis",
  pulse: "emphasis",
  blink: "emphasis",
};

const TOKEN = 56;

export function buildDemoPlan(): Plan {
  z = 0;
  const objects: PlanObject[] = [];

  objects.push(
    object({
      id: "title",
      type: "text",
      x: 40,
      y: 24,
      w: 520,
      h: 44,
      label: "RaidPlans feature demo",
      tint: "#e6e6e6",
      name: "Title",
    }),
  );

  // --- Row 1: one of every shape kind ------------------------------------
  SHAPE_KINDS.forEach((shape, i) => {
    const size = SHAPE_SIZE[shape] ?? DEFAULT_SHAPE_SIZE;
    objects.push(
      object({
        id: `shape-${shape}`,
        type: "shape",
        shape,
        x: 60 + i * 210,
        y: 110,
        w: size.w,
        h: size.h,
        label: shape,
        name: `Shape: ${shape}`,
        tint: "#4f9dff",
      }),
    );
  });

  // --- Row 2: the style options, so form/colour can be compared side by side
  const styles: {
    id: string;
    shape: PlanObject["shape"];
    style: ObjectStyle;
  }[] = [
    { id: "void-scalloped", shape: "voidzone", style: { edge: "scalloped" } },
    { id: "void-round", shape: "voidzone", style: { edge: "round" } },
    { id: "void-striped", shape: "voidzone", style: { fill: "striped" } },
    { id: "circle-solid", shape: "circle", style: { fill: "solid" } },
    { id: "circle-hollow", shape: "circle", style: { fill: "none" } },
    {
      id: "rect-no-outline",
      shape: "rect",
      style: { fill: "soft", outline: false },
    },
    { id: "soak-hazard", shape: "soak", style: { fill: "hazard" } },
  ];
  styles.forEach((s, i) => {
    objects.push(
      object({
        id: `style-${s.id}`,
        type: "shape",
        shape: s.shape,
        style: s.style,
        x: 60 + i * 210,
        y: 300,
        w: 130,
        h: 130,
        label: s.id.replace(/^[a-z]+-/, ""),
        name: `Style: ${s.id}`,
        tint: "#ff6b6b",
      }),
    );
  });

  // --- Row 3: one token per animation effect, animated with it in step 1 --
  const EFFECT_ICON: Record<AnimEffect, string> = {
    appear: "class-mage",
    disappear: "class-warlock",
    fade: "class-priest",
    fly: "class-hunter",
    move: "class-rogue",
    scale: "class-druid",
    pulse: "class-paladin",
    blink: "class-shaman",
  };
  ANIM_EFFECTS.forEach((effect, i) => {
    objects.push(
      object({
        id: `fx-${effect}`,
        type: "token",
        iconId: EFFECT_ICON[effect],
        x: 70 + i * 120,
        y: 500,
        w: TOKEN,
        h: TOKEN,
        label: effect,
        name: `FX: ${effect}`,
      }),
    );
  });

  // --- Row 4: a raid group for chaining, tethers and the collision pickup --
  objects.push(
    object({
      id: "tok-tank",
      type: "token",
      iconId: "role-tank",
      x: 120,
      y: 700,
      w: TOKEN,
      h: TOKEN,
      name: "Tank",
      label: "MT",
    }),
    object({
      id: "tok-healer",
      type: "token",
      iconId: "role-healer",
      x: 120,
      y: 790,
      w: TOKEN,
      h: TOKEN,
      name: "Healer",
      label: "H1",
    }),
    object({
      id: "tok-dps",
      type: "token",
      iconId: "role-dps",
      x: 210,
      y: 745,
      w: TOKEN,
      h: TOKEN,
      name: "DPS",
      label: "D1",
    }),
    // The runner crosses the orb during step 3 — that's the collision demo.
    object({
      id: "tok-runner",
      type: "token",
      iconId: "class-demonhunter",
      x: 700,
      y: 700,
      w: TOKEN,
      h: TOKEN,
      name: "Runner",
      label: "grabs the orb",
    }),
    object({
      id: "orb",
      type: "shape",
      shape: "pickup",
      x: 1000,
      y: 690,
      w: 80,
      h: 80,
      name: "Orb",
      label: "orb",
      tint: "#ffd166",
    }),
    object({
      id: "secret",
      type: "shape",
      shape: "soak",
      x: 1300,
      y: 690,
      w: 110,
      h: 110,
      name: "Click target",
      label: "click me",
      tint: "#8ce99a",
      style: { fill: "striped" },
    }),
    object({
      id: "arrow-1",
      type: "arrow",
      x: 700,
      y: 620,
      w: 300,
      h: 24,
      name: "Route arrow",
      tint: "#4f9dff",
    }),
    // Both tether line styles.
    object({
      id: "tether-squiggly",
      type: "tether",
      fromId: "tok-tank",
      toId: "tok-healer",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      name: "Tether (squiggly)",
      tint: "#b36bff",
    }),
    object({
      id: "tether-straight",
      type: "tether",
      fromId: "tok-healer",
      toId: "tok-dps",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      name: "Tether (straight)",
      tint: "#66d9e8",
      style: { line: "straight" },
    }),
  );

  // --- Steps --------------------------------------------------------------

  /** Step 1 — every effect at once, staggered so you can watch them land. */
  const showcase: Anim[] = ANIM_EFFECTS.map((effect, i) =>
    anim({
      id: `a-fx-${effect}`,
      objectId: `fx-${effect}`,
      kind: EFFECT_KIND[effect],
      effect,
      trigger: "onEnter",
      delayMs: i * 250,
      durationMs: 700,
      // `fly` needs somewhere to fly in from.
      ...(effect === "fly" ? { params: { toX: -200, toY: 500 } } : {}),
    }),
  );

  const plan: Plan = {
    id: "demo",
    title: "RaidPlans feature demo",
    raid: "Feature demo",
    background: { ...BOARD },
    objects,
    attacks: [],
    steps: [
      {
        id: "step-effects",
        name: "1 · Every effect",
        // `move` and `scale` need an end state to travel to.
        overrides: {
          "fx-move": { x: 70 + 4 * 120, y: 580 },
          "fx-scale": { w: TOKEN * 1.8, h: TOKEN * 1.8 },
        },
        animations: showcase,
      },
      {
        id: "step-chaining",
        name: "2 · Trigger chaining",
        // The three roles walk right; watch how the triggers sequence them.
        overrides: {
          "tok-tank": { x: 620 },
          "tok-healer": { x: 620 },
          "tok-dps": { x: 700 },
        },
        animations: [
          anim({
            id: "a-chain-1",
            objectId: "tok-tank",
            kind: "motion",
            effect: "move",
            trigger: "onEnter",
            durationMs: 800,
          }),
          anim({
            id: "a-chain-2",
            objectId: "tok-healer",
            kind: "motion",
            effect: "move",
            trigger: "withPrevious",
            durationMs: 800,
          }),
          anim({
            id: "a-chain-3",
            objectId: "tok-dps",
            kind: "motion",
            effect: "move",
            trigger: "afterPrevious",
            durationMs: 800,
          }),
        ],
      },
      {
        id: "step-collision",
        name: "3 · Collision pickup",
        // The runner crosses the orb's box on the way right.
        overrides: { "tok-runner": { x: 1300 } },
        animations: [
          anim({
            id: "a-run",
            objectId: "tok-runner",
            kind: "motion",
            effect: "move",
            trigger: "onEnter",
            durationMs: 2200,
            easing: "none",
          }),
          // Armed against the runner: the orb vanishes on contact, once.
          anim({
            id: "a-orb-grabbed",
            objectId: "orb",
            kind: "exit",
            effect: "disappear",
            trigger: "onCollision",
            collideWith: ["tok-runner"],
            durationMs: 200,
          }),
        ],
      },
      {
        id: "step-click",
        name: "4 · Click trigger",
        overrides: {},
        animations: [
          anim({
            id: "a-click",
            objectId: "secret",
            kind: "emphasis",
            effect: "pulse",
            trigger: "onClick",
            durationMs: 500,
          }),
          anim({
            id: "a-click-fade",
            objectId: "arrow-1",
            kind: "exit",
            effect: "fade",
            trigger: "onClick",
            durationMs: 400,
          }),
        ],
        autoAdvanceMs: 3000,
      },
    ],
    schemaVersion: SCHEMA_VERSION,
  };

  return plan;
}
