import { describe, expect, it } from "vitest";
import {
  filterPlans,
  planRaids,
  relativeTime,
} from "../../src/routes/planFilters";

const plan = (title: string, raid: string) => ({ title, raid });

describe("filterPlans", () => {
  const plans = [
    plan("Mythic Council", "Nerub-ar Palace"),
    plan("Heroic Ansurek", "Nerub-ar Palace"),
    plan("Arena comp", ""),
  ];

  it("returns everything for an empty filter", () => {
    expect(filterPlans(plans, {})).toHaveLength(3);
  });

  it("matches the query against title and raid", () => {
    expect(
      filterPlans(plans, { query: "council" }).map((p) => p.title),
    ).toEqual(["Mythic Council"]);
    expect(filterPlans(plans, { query: "nerub" })).toHaveLength(2);
  });

  it("filters to an exact raid", () => {
    expect(filterPlans(plans, { raid: "Nerub-ar Palace" })).toHaveLength(2);
    expect(filterPlans(plans, { raid: "" })).toHaveLength(3); // empty = all
  });

  it("combines query and raid", () => {
    expect(
      filterPlans(plans, { raid: "Nerub-ar Palace", query: "heroic" }).map(
        (p) => p.title,
      ),
    ).toEqual(["Heroic Ansurek"]);
  });
});

describe("planRaids", () => {
  it("returns the distinct, sorted, non-empty raids", () => {
    expect(
      planRaids([
        plan("a", "Zul"),
        plan("b", "Aberrus"),
        plan("c", "Zul"),
        plan("d", ""),
      ]),
    ).toEqual(["Aberrus", "Zul"]);
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 6, 18, 12, 0, 0); // fixed reference
  const sec = (ms: number) => Math.floor((now - ms) / 1000);

  it("labels recent times relatively", () => {
    expect(relativeTime(sec(0), now)).toBe("just now");
    expect(relativeTime(sec(5 * 60_000), now)).toBe("5m ago");
    expect(relativeTime(sec(3 * 3_600_000), now)).toBe("3h ago");
    expect(relativeTime(sec(2 * 86_400_000), now)).toBe("2d ago");
  });

  it("falls back to a short date beyond a week", () => {
    expect(relativeTime(sec(30 * 86_400_000), now)).toMatch(/[A-Za-z]{3} \d+/);
  });
});
