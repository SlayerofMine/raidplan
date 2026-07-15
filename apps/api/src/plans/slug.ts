import { randomBytes } from "node:crypto";

/**
 * Share slugs (plan §10 "Sharing"). Slugs are the *only* thing protecting an
 * `unlisted` plan, so they must be unguessable: generated from a CSPRNG, not
 * from the title or a counter.
 *
 * The alphabet drops look-alike characters (0/O, 1/l/I) so a slug read aloud
 * on Discord or voice comms survives the trip.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const SLUG_LENGTH = 10;

/**
 * ~10 chars from a 31-symbol alphabet ≈ 49 bits of entropy — far beyond
 * guessing at guild scale.
 */
export function generateSlug(length = SLUG_LENGTH): string {
  // Rejection-free: 256 % 31 != 0 would bias, so mask to the nearest power of
  // two and redraw on overflow.
  const out: string[] = [];
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      const index = byte & 31; // 0..31
      if (index >= ALPHABET.length) continue; // redraw, keeps it uniform
      out.push(ALPHABET[index]!);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

/** Does this look like a slug we issued? Cheap guard before touching the DB. */
export function isValidSlug(slug: string): boolean {
  if (slug.length < 4 || slug.length > 32) return false;
  return [...slug].every((c) => ALPHABET.includes(c));
}
