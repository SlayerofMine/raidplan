import type { AnimEffect, AnimKind } from "@raidplan/shared";

/**
 * Which effects belong to which animation family, and what to call them
 * (plan §7).
 *
 * `kind` and `effect` are two independent enums in the document, which is right
 * for storage and wrong for a picker: it offered all eight effects under all
 * four families, so "entrance · disappear" was a valid thing to build, and
 * **fading out was invisible** — it's `fade` under `exit`, and nothing said so.
 * Here the vocabulary is stated once: a family's effects, in the order a picker
 * should offer them, and the name each one goes by in that family.
 *
 * This mirrors what `compileStep` actually does. `fly` is deliberately absent
 * from `exit`: it flies *to* the slide's end state, which is an entrance's job —
 * offering it as an exit would be offering something that doesn't exist.
 *
 * `move` is likewise absent from `motion`: a move is a drawn path, made by
 * clicking out its legs on the canvas, and a move picked from a dropdown has no
 * path to follow. Existing moves still open and edit normally — `effectsForKind`
 * always keeps `current`.
 */
const BY_KIND: Record<AnimKind, AnimEffect[]> = {
  entrance: ["fade", "appear", "fly"],
  exit: ["fade", "disappear"],
  emphasis: ["pulse", "blink"],
  motion: ["scale"],
};

/** Names that read differently depending on the family they're used in. */
const DIRECTIONAL: Partial<
  Record<AnimKind, Partial<Record<AnimEffect, string>>>
> = {
  entrance: { fade: "fade in", fly: "fly in" },
  exit: { fade: "fade out" },
};

/**
 * Effects offered for a family. `current` is always included even if it isn't
 * one of them, so opening an older animation can never quietly rewrite it.
 */
export function effectsForKind(
  kind: AnimKind,
  current?: AnimEffect,
): AnimEffect[] {
  const offered = BY_KIND[kind];
  return current && !offered.includes(current)
    ? [...offered, current]
    : offered;
}

/** What this effect is called in this family — "fade" is "fade out" in an exit. */
export function effectLabel(kind: AnimKind, effect: AnimEffect): string {
  return DIRECTIONAL[kind]?.[effect] ?? effect;
}

/** The effect a family starts on when you switch to it. */
export function defaultEffectFor(kind: AnimKind): AnimEffect {
  return BY_KIND[kind][0]!;
}

/**
 * Effects that happen at an instant rather than over time.
 *
 * They ignore duration and easing entirely — `appear` is a switch, not a tween
 * (fade is the timed one) — so a panel offering those controls for them would be
 * offering controls that do nothing.
 */
export function isInstantEffect(effect: AnimEffect): boolean {
  return effect === "appear" || effect === "disappear";
}
