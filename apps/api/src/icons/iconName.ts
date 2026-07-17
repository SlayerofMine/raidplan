import type { IconCatalogCategory } from "@raidplan/shared";

/**
 * Derive a category, search tags and a display name from a WoW icon name
 * (plan §11.1 "Names → categories & search").
 *
 * WoW icon names are `lower_snake_case`, and the leading token is a reliable
 * bucket: `spell_fire_fireball02`, `ability_rogue_ambush`, `inv_sword_04`,
 * `achievement_boss_ragnaros`, `trade_alchemy`, `classicon_warrior`. We lean on
 * that to categorise ~40k icons with **zero manual tagging**.
 *
 * This is pure and *total*: any string yields a result (unknown prefixes fall
 * to `misc`), so the palette's filter chips stay a closed set and no icon is
 * ever un-searchable.
 */

/** Leading name token → category. Anything unlisted is `misc`. */
const PREFIX_CATEGORY: Readonly<Record<string, IconCatalogCategory>> = {
  spell: "spell",
  ability: "ability",
  inv: "item", // "inventory" — items, gear, weapons
  item: "item",
  achievement: "achievement",
  class: "class",
  classicon: "class",
  spec: "spec",
  trade: "trade", // profession/tradeskill glyphs
  ui: "ui",
  interface: "ui",
};

/** Tokens that are noise as search terms — the bucket prefixes themselves. */
const STOPWORDS = new Set(Object.keys(PREFIX_CATEGORY));

export interface ParsedIconName {
  category: IconCatalogCategory;
  /** Unique, de-numbered search terms (never empty of meaning). */
  tags: string[];
  /** Human-readable label for the palette tile. */
  displayName: string;
}

/** Split a name into lowercase word tokens. */
function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/) // `_`, spaces, dots, anything non-alphanumeric
    .filter(Boolean);
}

/** Drop a trailing run of digits (`fireball02` → `fireball`, `04` → ``). */
function deNumber(token: string): string {
  return token.replace(/\d+$/, "");
}

export function categorizeIconName(name: string): ParsedIconName {
  const tokens = tokenize(name);
  const category: IconCatalogCategory =
    (tokens[0] && PREFIX_CATEGORY[tokens[0]]) || "misc";

  // Tags: meaningful words, de-numbered, deduped, with the bucket prefixes and
  // one/zero-letter fragments removed. Keep the category itself as a tag so a
  // search for "spell" still works.
  const tags = new Set<string>();
  for (const token of tokens) {
    const word = deNumber(token);
    if (word.length >= 3 && !STOPWORDS.has(word)) tags.add(word);
  }
  tags.add(category);

  return {
    category,
    tags: [...tags],
    displayName: toDisplayName(name),
  };
}

/**
 * A readable label from a raw name: strip the leading bucket prefix, split
 * digit runs off words, and title-case. `spell_fire_fireball02` → "Fire
 * Fireball 02"; `inv_sword_04` → "Sword 04". Falls back to the raw name if
 * stripping leaves nothing.
 */
export function toDisplayName(name: string): string {
  const tokens = tokenize(name);
  const withoutPrefix =
    tokens.length > 1 && tokens[0] && STOPWORDS.has(tokens[0])
      ? tokens.slice(1)
      : tokens;
  const source = withoutPrefix.length > 0 ? withoutPrefix : tokens;

  const words = source.flatMap((token) => {
    // Separate a trailing number into its own word: `fireball02` → `fireball`,
    // `02`.
    const match = /^([a-z]+)(\d+)$/.exec(token);
    return match ? [match[1]!, match[2]!] : [token];
  });

  const label = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();

  return label || name;
}
