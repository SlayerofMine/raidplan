import { describe, expect, it, vi } from "vitest";
import {
  fetchIconCatalog,
  IconCatalogError,
  resolveIcons,
} from "./iconCatalog";

const page = {
  items: [
    {
      id: "spell_fire_a",
      displayName: "Fire A",
      category: "spell",
      url56: "/icons/a_56.webp",
      url112: "/icons/a_112.webp",
    },
  ],
  nextCursor: null,
};

const okFetch = (body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;

const calls = (f: typeof fetch) =>
  (f as unknown as ReturnType<typeof vi.fn>).mock.calls;

describe("fetchIconCatalog", () => {
  it("builds the query string, sends credentials, and parses the page", async () => {
    const fetchImpl = okFetch(page);
    const result = await fetchIconCatalog(
      { query: "fire", category: "spell", cursor: "c1" },
      fetchImpl,
    );

    expect(result).toEqual(page);
    const [url, init] = calls(fetchImpl)[0]!;
    expect(url).toContain("query=fire");
    expect(url).toContain("category=spell");
    expect(url).toContain("cursor=c1");
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("omits empty params", async () => {
    const fetchImpl = okFetch(page);
    await fetchIconCatalog({}, fetchImpl);
    expect(calls(fetchImpl)[0]![0]).toBe("/api/icons?");
  });

  it("throws IconCatalogError carrying the status on a non-2xx", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(fetchIconCatalog({}, fetchImpl)).rejects.toBeInstanceOf(
      IconCatalogError,
    );
    await expect(fetchIconCatalog({}, fetchImpl)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects a malformed page — the schema is the guard", async () => {
    const fetchImpl = okFetch({ items: [{ id: "x" }], nextCursor: null });
    await expect(fetchIconCatalog({}, fetchImpl)).rejects.toThrow();
  });
});

describe("resolveIcons", () => {
  const entry = (id: string) => ({
    id,
    displayName: id,
    category: "spell" as const,
    url56: `/icons/${id}_56.webp`,
    url112: `/icons/${id}_112.webp`,
  });

  it("requests the ids and returns the resolved entries", async () => {
    const fetchImpl = okFetch({ items: [entry("spell_fire_a")] });
    const result = await resolveIcons(["spell_fire_a"], fetchImpl);

    expect(result).toEqual([entry("spell_fire_a")]);
    const [url, init] = calls(fetchImpl)[0]!;
    expect(url).toContain("/api/icons/resolve?ids=spell_fire_a");
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("returns nothing (and makes no request) for an empty id list", async () => {
    const fetchImpl = okFetch({ items: [] });
    expect(await resolveIcons([], fetchImpl)).toEqual([]);
    expect(calls(fetchImpl)).toHaveLength(0);
  });

  it("chunks large id lists across multiple requests", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `icon_${i}`);
    const fetchImpl = okFetch({ items: [] });
    await resolveIcons(ids, fetchImpl);
    // 450 ids / 200-per-request → 3 calls.
    expect(calls(fetchImpl)).toHaveLength(3);
  });

  it("throws IconCatalogError on a non-2xx", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(resolveIcons(["a"], fetchImpl)).rejects.toBeInstanceOf(
      IconCatalogError,
    );
  });
});
