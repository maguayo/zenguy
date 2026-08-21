import type { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";

import type { Action } from "@/lib/permissions";

export type FeatherName = ComponentProps<typeof Feather>["name"];

export interface MoreMenuItem {
  icon: FeatherName;
  label: string;
  path: string;
  permission?: Action;
}

/** The web sidebar entries that live under the "More" tab, in the same order. */
export const moreMenuItems: MoreMenuItem[] = [
  { icon: "bell", label: "Notifications", path: "notifications" },
  { icon: "key", label: "Secrets", path: "secrets" },
  { icon: "users", label: "Members", path: "members" },
  { icon: "bar-chart-2", label: "Plan & Usage", path: "billing", permission: "billing.view" },
  { icon: "settings", label: "Workspace Settings", path: "settings" },
];

export function visibleMoreItems(can: (action: Action) => boolean): MoreMenuItem[] {
  return moreMenuItems.filter((item) => !item.permission || can(item.permission));
}
