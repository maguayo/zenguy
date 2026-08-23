import { can, PERMISSIONS, type Action } from "./permissions";
import type { Role } from "./types";

const ALL_ACTIONS = Object.keys(PERMISSIONS.OWNER) as Action[];

describe("workspace permissions", () => {
  it("grants the owner every action", () => {
    for (const action of ALL_ACTIONS) expect(can("OWNER", action)).toBe(true);
  });

  it("matches the authoritative admin permissions", () => {
    const denied: Action[] = [
      "admins.manage",
      "billing.manage",
      "paid_alerts.manage",
      "workspace.transfer",
      "workspace.delete",
    ];
    for (const action of ALL_ACTIONS) {
      expect(can("ADMIN", action), action).toBe(!denied.includes(action));
    }
  });

  it("allows members only to view tests and download reports", () => {
    const allowed: Action[] = ["tests.view", "reports.download"];
    for (const action of ALL_ACTIONS) {
      expect(can("MEMBER", action), action).toBe(allowed.includes(action));
    }
  });

  it("contains a complete entry for every role and action", () => {
    const roles: Role[] = ["OWNER", "ADMIN", "MEMBER"];
    for (const role of roles) {
      expect(Object.keys(PERMISSIONS[role]).sort()).toEqual(
        [...ALL_ACTIONS].sort(),
      );
    }
  });
});
