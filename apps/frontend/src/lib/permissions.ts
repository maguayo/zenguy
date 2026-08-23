import type { Role } from "../api/types";

export type Action =
  | "tests.view"
  | "tests.manage"
  | "tests.run"
  | "reports.download"
  | "uptime.manage"
  | "channels.manage"
  | "paid_alerts.manage"
  | "secrets.manage"
  | "members.invite"
  | "members.remove"
  | "admins.manage"
  | "billing.view"
  | "billing.manage"
  | "workspace.settings"
  | "workspace.transfer"
  | "workspace.delete"
  | "audit.view";

export const actions: Action[] = [
  "tests.view",
  "tests.manage",
  "tests.run",
  "reports.download",
  "uptime.manage",
  "channels.manage",
  "paid_alerts.manage",
  "secrets.manage",
  "members.invite",
  "members.remove",
  "admins.manage",
  "billing.view",
  "billing.manage",
  "workspace.settings",
  "workspace.transfer",
  "workspace.delete",
  "audit.view",
];

const adminActions = new Set<Action>([
  "tests.view",
  "tests.manage",
  "tests.run",
  "reports.download",
  "uptime.manage",
  "channels.manage",
  "secrets.manage",
  "members.invite",
  "members.remove",
  "billing.view",
  "workspace.settings",
  "audit.view",
]);

const memberActions = new Set<Action>(["tests.view", "reports.download"]);

export function can(role: Role, action: Action): boolean {
  if (role === "OWNER") return true;
  if (role === "ADMIN") return adminActions.has(action);
  return memberActions.has(action);
}
