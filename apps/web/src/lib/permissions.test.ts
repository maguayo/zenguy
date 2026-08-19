import { describe, expect, it } from "vitest";

import type { Role } from "../api/types";
import { actions, can, type Action } from "./permissions";

const expected: Record<Role, Record<Action, boolean>> = {
  OWNER: Object.fromEntries(actions.map((action) => [action, true])) as Record<Action, boolean>,
  ADMIN: {
    "admins.manage": false,
    "audit.view": true,
    "billing.manage": false,
    "billing.view": true,
    "channels.manage": true,
    "members.invite": true,
    "members.remove": true,
    "reports.download": true,
    "secrets.manage": true,
    "tests.manage": true,
    "tests.run": true,
    "tests.view": true,
    "uptime.manage": true,
    "workspace.delete": false,
    "workspace.settings": true,
    "workspace.transfer": false,
  },
  MEMBER: {
    "admins.manage": false,
    "audit.view": false,
    "billing.manage": false,
    "billing.view": false,
    "channels.manage": false,
    "members.invite": false,
    "members.remove": false,
    "reports.download": true,
    "secrets.manage": false,
    "tests.manage": false,
    "tests.run": false,
    "tests.view": true,
    "uptime.manage": false,
    "workspace.delete": false,
    "workspace.settings": false,
    "workspace.transfer": false,
  },
};

describe("permission matrix", () => {
  for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
    it(`matches every ${role} permission`, () => {
      for (const action of actions) {
        expect(can(role, action), `${role} ${action}`).toBe(expected[role][action]);
      }
    });
  }
});
