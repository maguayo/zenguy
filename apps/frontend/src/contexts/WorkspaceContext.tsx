import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";

import { listWorkspaces } from "../api/workspaces";
import type { Role, SubscriptionStatus, Workspace } from "../api/types";
import { Card } from "../components/ui/Card";
import { ErrorState } from "../components/ui/ErrorState";
import { Spinner } from "../components/ui/Spinner";
import { can as roleCan, type Action } from "../lib/permissions";

export interface WorkspaceContextValue {
  can: (action: Action) => boolean;
  current: Workspace;
  role: Role;
  subscriptionStatus: SubscriptionStatus;
  timezone: string;
  workspaces: Workspace[];
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function resolveWorkspace(
  workspaces: Workspace[],
  workspaceId: string | undefined,
): Workspace | undefined {
  return workspaces.find((workspace) => workspace.id === workspaceId);
}

export function requiresBillingSetup(status: SubscriptionStatus): boolean {
  return status === "NONE" || status === "CANCELED";
}

function WorkspaceNotFound({ workspaces }: { workspaces: Workspace[] }) {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-lg text-center">
        <h1 className="text-xl font-semibold text-zinc-900">Workspace not found</h1>
        <p className="mt-2 text-sm text-zinc-500">
          You may no longer have access. Choose one of your workspaces instead.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              to={`/w/${workspace.id}/overview`}
            >
              {workspace.name}
            </Link>
          ))}
        </div>
      </Card>
    </main>
  );
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { wsId } = useParams();
  const location = useLocation();
  const query = useQuery({ queryFn: listWorkspaces, queryKey: ["workspaces"] });
  const current = resolveWorkspace(query.data ?? [], wsId);

  useEffect(() => {
    if (current) localStorage.setItem("zenguy:lastWorkspace", current.id);
  }, [current]);

  const can = useCallback(
    (action: Action) => (current ? roleCan(current.role, action) : false),
    [current],
  );

  const value = useMemo<WorkspaceContextValue | null>(
    () =>
      current
        ? {
            can,
            current,
            role: current.role,
            subscriptionStatus: current.subscriptionStatus,
            timezone: current.timezone,
            workspaces: query.data ?? [],
          }
        : null,
    [can, current, query.data],
  );

  if (query.isPending) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading workspace" size={6} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <ErrorState onRetry={() => void query.refetch()} />
      </main>
    );
  }
  if (query.data.length === 0) return <Navigate replace to="/onboarding/workspace" />;
  if (!current || !value) return <WorkspaceNotFound workspaces={query.data} />;

  const billingRoute = location.pathname === `/w/${current.id}/billing`;
  if (requiresBillingSetup(current.subscriptionStatus) && !billingRoute) {
    return <Navigate replace to={`/w/${current.id}/setup/billing`} />;
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return value;
}
