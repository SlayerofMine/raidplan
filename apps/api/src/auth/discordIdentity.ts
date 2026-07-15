import type { RoleMapping } from "../config.js";
import type { Role } from "../db/schema.js";

/**
 * Talking to Discord (plan §10).
 *
 * `fetch` is injected everywhere so every branch — member, not a member, token
 * rejected, Discord having a bad day — is testable without the network. The
 * membership check is a security control: "is this person on our server" decides
 * who gets in at all, so it must fail *closed* on anything unexpected.
 */
const DISCORD_API = "https://discord.com/api";

export type Fetch = typeof globalThis.fetch;

/** The subset of Discord's user object we use (scope: `identify`). */
export interface DiscordProfile {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator?: string;
  avatar?: string | null;
}

/** The subset of Discord's guild-member object we use. */
export interface DiscordMember {
  /** Role ids held on the server. */
  roles: string[];
  nick?: string | null;
}

/**
 * A synthetic address standing in for the email we deliberately never ask for.
 *
 * better-auth's user model requires an email, but RaidPlans requests only
 * `identify` + `guilds.members.read` — a member's email is none of our business
 * for a guild planning tool.
 *
 * `.invalid` is reserved by RFC 2606 precisely for addresses that are
 * guaranteed never to resolve, so this can never accidentally reach a real
 * inbox. It is deliberately self-describing, and always stored with
 * `emailVerified: false`.
 *
 * **Never send mail to these.** If RaidPlans ever needs to email people, ask
 * Discord for the `email` scope rather than making this look more real.
 */
export function syntheticEmail(discordId: string): string {
  return `discord-${discordId}@raidplans.invalid`;
}

/** True for an address minted by {@link syntheticEmail}. */
export function isSyntheticEmail(email: string): boolean {
  return email.endsWith("@raidplans.invalid");
}

/** Discord's CDN URL for a user's avatar, with their default as a fallback. */
export function avatarUrl(profile: DiscordProfile): string {
  if (!profile.avatar) {
    const index =
      profile.discriminator && profile.discriminator !== "0"
        ? Number(profile.discriminator) % 5
        : Number((BigInt(profile.id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  const format = profile.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${format}`;
}

/** The display name we store: Discord's global name, else the username. */
export function displayName(profile: DiscordProfile): string {
  return profile.global_name?.trim() || profile.username;
}

/**
 * Map a member's Discord role ids onto a RaidPlans role, highest wins.
 *
 * Pure, so the privilege calculation is testable on its own — an accidental
 * promotion here would hand out edit rights across the guild.
 */
export function roleForMember(
  memberRoleIds: readonly string[],
  mapping: RoleMapping,
): Role {
  const held = new Set(memberRoleIds);
  if (mapping.ownerRoleIds.some((id) => held.has(id))) return "owner";
  if (mapping.editorRoleIds.some((id) => held.has(id))) return "editor";
  return mapping.defaultRole;
}

/** Fetch the signed-in user's Discord profile, or null if the token is bad. */
export async function fetchDiscordProfile(
  accessToken: string,
  fetchImpl: Fetch = fetch,
): Promise<DiscordProfile | null> {
  try {
    const res = await fetchImpl(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const profile = (await res.json()) as DiscordProfile;
    return profile?.id ? profile : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the user's membership of **one** server (scope: `guilds.members.read`).
 *
 * Asking about a single server — rather than listing every server they're in
 * with the broader `guilds` scope — is the whole point: we only ever need this
 * one question answered.
 *
 * Returns `null` when they aren't a member (Discord answers 404) **and** on any
 * error: an unreachable Discord must not become an open door.
 */
export async function fetchGuildMember(
  accessToken: string,
  guildId: string,
  fetchImpl: Fetch = fetch,
): Promise<DiscordMember | null> {
  try {
    const res = await fetchImpl(
      `${DISCORD_API}/users/@me/guilds/${guildId}/member`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null; // 404 = not on the server; anything else = fail closed
    const member = (await res.json()) as DiscordMember;
    return Array.isArray(member?.roles) ? member : null;
  } catch {
    return null;
  }
}

/** A verified guild member, ready to become a RaidPlans user. */
export interface VerifiedIdentity {
  discordId: string;
  name: string;
  email: string;
  image: string;
  role: Role;
}

/**
 * The whole login gate: who are you, are you on our server, and what may you do.
 * Returns `null` to refuse the login.
 */
export async function verifyDiscordIdentity(params: {
  accessToken: string;
  guildId: string;
  roleMapping: RoleMapping;
  fetchImpl?: Fetch;
}): Promise<VerifiedIdentity | null> {
  const fetchImpl = params.fetchImpl ?? fetch;

  const profile = await fetchDiscordProfile(params.accessToken, fetchImpl);
  if (!profile) return null;

  const member = await fetchGuildMember(
    params.accessToken,
    params.guildId,
    fetchImpl,
  );
  if (!member) return null; // not on the server → no account, no session

  return {
    discordId: profile.id,
    name: displayName(profile),
    email: syntheticEmail(profile.id),
    image: avatarUrl(profile),
    role: roleForMember(member.roles, params.roleMapping),
  };
}
