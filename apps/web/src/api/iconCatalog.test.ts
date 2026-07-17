import { describe, expect, it, vi } from "vitest";
import { fetchIconCatalog, IconCatalogError } from "./iconCatalog";

const page = {
  items: [
    {
      id: "spell_fire_a",
      displayName: "Fire A",
      category: "spell",
      url: "/icons/a_56.webp",
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
