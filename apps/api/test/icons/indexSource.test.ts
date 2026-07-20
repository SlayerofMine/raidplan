import { describe, expect, it, vi } from "vitest";
import {
  listfileIndexSource,
  parseListfile,
} from "../../src/icons/indexSource.js";

describe("parseListfile", () => {
  const sample = [
    "1234;interface/icons/spell_fire_fireball02.blp",
    "5678;interface/icons/inv_sword_04.blp",
    "9999;interface/buttons/ui_checkbox.blp", // not an icon
    "4321;world/maps/azeroth/azeroth.wdt", // not an icon
    "", // blank
    "malformed line with no separator",
  ].join("\n");

  it("keeps only interface/icons *.blp rows, as name + FileDataID", () => {
    expect(parseListfile(sample)).toEqual([
      { name: "spell_fire_fireball02", fileDataId: 1234 },
      { name: "inv_sword_04", fileDataId: 5678 },
    ]);
  });

  it("tolerates a comma-separated variant and CRLF line endings", () => {
    const csv = "7;interface/icons/a.blp\r\n8,interface/icons/b.blp\r\n";
    expect(parseListfile(csv).map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("dedupes a repeated name, keeping the first FileDataID", () => {
    const dup = ["1;interface/icons/dup.blp", "2;interface/icons/dup.blp"].join(
      "\n",
    );
    expect(parseListfile(dup)).toEqual([{ name: "dup", fileDataId: 1 }]);
  });

  it("yields a null FileDataID when the id column is not a number", () => {
    expect(parseListfile("x;interface/icons/a.blp")).toEqual([
      { name: "a", fileDataId: null },
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseListfile("")).toEqual([]);
  });
});

describe("listfileIndexSource", () => {
  it("fetches and parses the configured URL", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("42;interface/icons/x.blp"),
    ) as unknown as typeof fetch;
    const source = listfileIndexSource({ fetchImpl, url: "http://list" });
    expect(await source.listIcons()).toEqual([{ name: "x", fileDataId: 42 }]);
    expect(fetchImpl).toHaveBeenCalledWith("http://list");
  });

  it("throws on a non-200 rather than treating an error page as the index", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(
      listfileIndexSource({ fetchImpl }).listIcons(),
    ).rejects.toThrow(/500/);
  });
});
