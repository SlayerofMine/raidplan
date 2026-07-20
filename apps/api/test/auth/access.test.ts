import { describe, expect, it } from "vitest";
import {
  canAdminister,
  canEdit,
  canList,
  canView,
  roleAtLeast,
  type PlanAcl,
  type Viewer,
} from "../../src/auth/access.js";

const OWNER = "user_owner";
const GUILD = "guild_1";

function plan(over: Partial<PlanAcl> = {}): PlanAcl {
  return {
    ownerId: OWNER,
    guildId: GUILD,
    visibility: "private",
    deletedAt: null,
    ...over,
  };
}

const owner: Viewer = { userId: OWNER, roles: {} };
const guildOwner: Viewer = { userId: "u_go", roles: { [GUILD]: "owner" } };
const editor: Viewer = { userId: "u_ed", roles: { [GUILD]: "editor" } };
const member: Viewer = { userId: "u_vi", roles: { [GUILD]: "viewer" } };
const outsider: Viewer = { userId: "u_out", roles: { other_guild: "owner" } };
const anonymous = null;

describe("roleAtLeast", () => {
  it("orders viewer < editor < owner", () => {
    expect(roleAtLeast("owner", "editor")).toBe(true);
    expect(roleAtLeast("editor", "viewer")).toBe(true);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast("editor", "owner")).toBe(false);
  });

  it("treats each role as meeting itself", () => {
    expect(roleAtLeast("editor", "editor")).toBe(true);
  });

  it("treats a missing role as insufficient", () => {
    expect(roleAtLeast(undefined, "viewer")).toBe(false);
  });
});

describe("canView", () => {
  it("lets anyone with the link read public and unlisted plans", () => {
    for (const visibility of ["public", "unlisted"] as const) {
      expect(canView(plan({ visibility }), anonymous)).toBe(true);
      expect(canView(plan({ visibility }), outsider)).toBe(true);
    }
  });

  it("hides a private plan from anonymous visitors and outsiders", () => {
    expect(canView(plan(), anonymous)).toBe(false);
    expect(canView(plan(), outsider)).toBe(false);
  });

  it("shows a private plan to its owner and to guild members", () => {
    expect(canView(plan(), owner)).toBe(true);
    expect(canView(plan(), member)).toBe(true);
    expect(canView(plan(), editor)).toBe(true);
  });

  it("hides a soft-deleted plan from everyone, link or not", () => {
    const deleted = { deletedAt: 1_700_000_000 };
    expect(canView(plan({ ...deleted, visibility: "public" }), anonymous)).toBe(
      false,
    );
    expect(canView(plan(deleted), owner)).toBe(false);
    expect(canView(plan(deleted), guildOwner)).toBe(false);
  });

  it("does not leak a guildless private plan to anyone but its owner", () => {
    const orphan = plan({ guildId: null });
    expect(canView(orphan, owner)).toBe(true);
    expect(canView(orphan, guildOwner)).toBe(false);
    expect(canView(orphan, anonymous)).toBe(false);
  });

  it("ignores a role held in a different guild", () => {
    expect(canView(plan(), outsider)).toBe(false);
  });
});

describe("canEdit", () => {
  it("allows the owner and guild editors/owners", () => {
    expect(canEdit(plan(), owner)).toBe(true);
    expect(canEdit(plan(), editor)).toBe(true);
    expect(canEdit(plan(), guildOwner)).toBe(true);
  });

  it("refuses plain viewers, outsiders and anonymous visitors", () => {
    expect(canEdit(plan(), member)).toBe(false);
    expect(canEdit(plan(), outsider)).toBe(false);
    expect(canEdit(plan(), anonymous)).toBe(false);
  });

  it("does not make a public plan world-writable", () => {
    const open = plan({ visibility: "public" });
    expect(canView(open, outsider)).toBe(true);
    expect(canEdit(open, outsider)).toBe(false);
    expect(canEdit(open, anonymous)).toBe(false);
  });

  it("refuses edits to a soft-deleted plan, even by its owner", () => {
    expect(canEdit(plan({ deletedAt: 1 }), owner)).toBe(false);
  });
});

describe("canAdminister", () => {
  it("allows the plan owner and guild owners only", () => {
    expect(canAdminister(plan(), owner)).toBe(true);
    expect(canAdminister(plan(), guildOwner)).toBe(true);
  });

  it("refuses editors — editing is not administering", () => {
    expect(canEdit(plan(), editor)).toBe(true);
    expect(canAdminister(plan(), editor)).toBe(false);
  });

  it("refuses viewers, outsiders and anonymous visitors", () => {
    expect(canAdminister(plan(), member)).toBe(false);
    expect(canAdminister(plan(), outsider)).toBe(false);
    expect(canAdminister(plan(), anonymous)).toBe(false);
  });
});

describe("canList", () => {
  it("lists public plans to everyone", () => {
    expect(canList(plan({ visibility: "public" }), anonymous)).toBe(true);
  });

  it("keeps unlisted plans out of listings while staying readable by link", () => {
    // This is the whole distinction between `unlisted` and `public`.
    const link = plan({ visibility: "unlisted" });
    expect(canView(link, anonymous)).toBe(true);
    expect(canList(link, anonymous)).toBe(false);
    expect(canList(link, outsider)).toBe(false);
    // …but its own guild still sees it in their list.
    expect(canList(link, member)).toBe(true);
    expect(canList(link, owner)).toBe(true);
  });

  it("lists private plans only to the owner and guild members", () => {
    expect(canList(plan(), owner)).toBe(true);
    expect(canList(plan(), member)).toBe(true);
    expect(canList(plan(), outsider)).toBe(false);
    expect(canList(plan(), anonymous)).toBe(false);
  });

  it("never lists a soft-deleted plan", () => {
    expect(canList(plan({ visibility: "public", deletedAt: 1 }), owner)).toBe(
      false,
    );
  });
});
