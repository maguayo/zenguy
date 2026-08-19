import type { Role } from "./types";

export type Action =
  | "tests.view"
  | "tests.manage"
  | "tests.run"
  | "reports.download"
  | "uptime.manage"
  | "channels.manage"
  | "secrets.manage"
  | "api_keys.manage"
  | "members.invite"
  | "members.remove"
  | "admins.manage"
  | "billing.view"
  | "billing.manage"
  | "workspace.settings"
  | "workspace.transfer"
  | "workspace.delete"
  | "audit.view";

export const PERMISSIONS = {
  OWNER: {
    "tests.view": true,
    "tests.manage": true,
    "tests.run": true,
    "reports.download": true,
    "uptime.manage": true,
    "channels.manage": true,
    "secrets.manage": true,
    "api_keys.manage": true,
    "members.invite": true,
    "members.remove": true,
    "admins.manage": true,
    "billing.view": true,
    "billing.manage": true,
    "workspace.settings": true,
    "workspace.transfer": true,
    "workspace.delete": true,
    "audit.view": true,
  },
  ADMIN: {
    "tests.view": true,
    "tests.manage": true,
    "tests.run": true,
    "reports.download": true,
    "uptime.manage": true,
    "channels.manage": true,
    "secrets.manage": true,
    "api_keys.manage": true,
    "members.invite": true,
    "members.remove": true,
    "admins.manage": false,
    "billing.view": true,
    "billing.manage": false,
    "workspace.settings": true,
    "workspace.transfer": false,
    "workspace.delete": false,
    "audit.view": true,
  },
  MEMBER: {
    "tests.view": true,
    "tests.manage": false,
    "tests.run": false,
    "reports.download": true,
    "uptime.manage": false,
    "channels.manage": false,
    "secrets.manage": false,
    "api_keys.manage": false,
    "members.invite": false,
    "members.remove": false,
    "admins.manage": false,
    "billing.view": false,
    "billing.manage": false,
    "workspace.settings": false,
    "workspace.transfer": false,
    "workspace.delete": false,
    "audit.view": false,
  },
} as const satisfies Record<Role, Record<Action, boolean>>;

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role][action];
}
