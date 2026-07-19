import { describe, expect, it } from "vitest";
import { ICONS, type ObjectType, type PlanObject } from "@raidplan/shared";
import { objectDisplayName } from "./objectName";

function obj(
  over: {
    id?: string;
    type?: ObjectType;
    iconId?: string;
    base?: Partial<PlanObject["base"]>;
  } = {},
): PlanObject {
  const { id = "obj_1", type = "token", iconId, base } = over;
  return {
    id,
    type,
    ...(iconId ? { iconId } : {}),
    base: {
      x: 0,
      y: 0,
      w: 64,
      h: 64,
      rotation: 0,
      opacity: 1,
      z: 0,
      visible: true,
      ...base,
    },
  };
}

describe("objectDisplayName", () => {
  it("prefers the explicit name", () => {
    expect(
      objectDisplayName(obj({ base: { name: "Tank 1", label: "T" } })),
    ).toBe("Tank 1");
  });

  it("falls back to the on-canvas label when unnamed", () => {
    expect(objectDisplayName(obj({ base: { label: "Boss" } }))).toBe("Boss");
  });

  it("ignores whitespace-only names and labels", () => {
    expect(
      objectDisplayName(obj({ base: { name: "   ", label: "Kite" } })),
    ).toBe("Kite");
  });

  it("uses the bundled icon's name for an unlabelled token", () => {
    const icon = ICONS[0]!;
    expect(objectDisplayName(obj({ iconId: icon.id }))).toBe(icon.name);
  });

  it("falls back to the type when there is nothing else — never the id", () => {
    const name = objectDisplayName(obj({ id: "obj_deadbeef", type: "shape" }));
    expect(name).toBe("Shape");
    expect(name).not.toContain("obj_");
  });

  it("is safe for a missing object", () => {
    expect(objectDisplayName(undefined)).toBe("Object");
  });
});
