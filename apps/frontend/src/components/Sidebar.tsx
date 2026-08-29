import type { ComponentType } from "react";
import {
  Activity,
  Bell,
  Gauge,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Settings,
  Signal,
  Siren,
  Users,
} from "lucide-react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { getBillingConfig } from "../api/billing";
import { useAuth } from "../contexts/AuthContext";
import { useWorkspace } from "../contexts/WorkspaceContext";
import type { Action } from "../lib/permissions";
import { Dropdown } from "./ui/Dropdown";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

interface NavigationItem {
  icon: ComponentType<{ "aria-hidden"?: boolean | "true"; className?: string }>;
  label: string;
  path: string;
  permission?: Action;
}

export const navigationItems: NavigationItem[] = [
  { icon: LayoutDashboard, label: "Overview", path: "overview" },
  { icon: Globe, label: "Browser Tests", path: "tests" },
  { icon: Activity, label: "Uptime", path: "uptime" },
  { icon: Siren, label: "Incidents", path: "incidents" },
  { icon: Signal, label: "Status Pages", path: "status-pages" },
  { icon: Bell, label: "Alerts", path: "alerts" },
  { icon: KeyRound, label: "Secrets", path: "secrets" },
  { icon: Users, label: "Members", path: "members" },
  {
    icon: Gauge,
    label: "Plan & Usage",
    path: "billing",
    permission: "billing.view",
  },
  { icon: Settings, label: "Workspace Settings", path: "settings" },
];

export function visibleNavigationItems(
  can: (action: Action) => boolean,
): NavigationItem[] {
  return navigationItems.filter((item) => !item.permission || can(item.permission));
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { can, current } = useWorkspace();
  const billingConfig = useQuery({
    queryFn: getBillingConfig,
    queryKey: ["billing-config"],
  });
  const base = `/w/${current.id}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="px-4 pb-4 pt-5">
        <NavLink
          className="inline-flex text-xl font-bold tracking-tight text-zinc-950"
          to={`${base}/overview`}
          onClick={onNavigate}
        >
          zenguy<span className="text-accent-600">.</span>
        </NavLink>
        <div className="mt-5">
          <WorkspaceSwitcher onNavigate={onNavigate} />
        </div>
      </div>

      <nav aria-label="Workspace" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {visibleNavigationItems(can).map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.path}>
                <NavLink
                  className={({ isActive }) =>
                    clsx(
                      "flex h-9 items-center gap-3 rounded-md px-3 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900",
                      (isActive ||
                        (item.path === "tests" && location.pathname.startsWith(`${base}/runs/`))) &&
                        "bg-accent-50 font-medium text-accent-700 hover:bg-accent-50 hover:text-accent-700",
                    )
                  }
                  end={item.path === "overview"}
                  to={`${base}/${item.path}`}
                  onClick={onNavigate}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-zinc-200 p-3">
        <Dropdown
          align="start"
          items={[
            ...(billingConfig.data?.canIssueComplimentaryGrants
              ? [
                  {
                    label: "Complimentary links",
                    onSelect: () => {
                      navigate("/complimentary");
                    },
                  },
                ]
              : []),
            {
              icon: <LogOut className="size-4" />,
              label: "Sign out",
              onSelect: () => void signOut(),
            },
          ]}
          triggerWrapperClassName="w-full"
          trigger={
            <button
              className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-zinc-50"
              type="button"
            >
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-50 text-xs font-semibold uppercase text-accent-700"
              >
                {user?.name.slice(0, 1) || user?.email.slice(0, 1) || "U"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-zinc-900">
                  {user?.name || "User"}
                </span>
                <span className="block truncate text-xs text-zinc-500">{user?.email}</span>
              </span>
            </button>
          }
        />
      </div>
    </div>
  );
}
