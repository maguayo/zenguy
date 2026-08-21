import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import type { Role, SubscriptionStatus, Workspace } from "@/api/types";
import { listWorkspaces } from "@/api/workspaces";
import { firstParam, workspaceHref } from "@/lib/links";
import { can as roleCan, type Action } from "@/lib/permissions";
import { secureStorage, storageKeys } from "@/lib/secure-storage";
import { spacing } from "@/theme";
import { Button, Card, ErrorState, Muted, Screen, Spinner, Title } from "@/ui";

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

export async function rememberWorkspace(workspaceId: string): Promise<void> {
  await secureStorage.setItem(storageKeys.lastWorkspace, workspaceId);
}

export async function lastWorkspaceId(): Promise<string | null> {
  return secureStorage.getItem(storageKeys.lastWorkspace);
}

function WorkspaceNotFound({ workspaces }: { workspaces: Workspace[] }) {
  const router = useRouter();
  return (
    <Screen safe={["top", "bottom"]}>
      <Card>
        <Title>Workspace not found</Title>
        <Muted style={styles.gap}>
          You may no longer have access. Choose one of your workspaces instead.
        </Muted>
        <View style={styles.list}>
          {workspaces.map((workspace) => (
            <Button
              key={workspace.id}
              fullWidth
              title={workspace.name}
              onPress={() => router.replace(workspaceHref(workspace.id))}
            />
          ))}
        </View>
      </Card>
    </Screen>
  );
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const params = useLocalSearchParams<{ wsId: string }>();
  const wsId = firstParam(params.wsId);
  const pathname = usePathname();
  const query = useQuery({ queryFn: listWorkspaces, queryKey: ["workspaces"] });
  const current = resolveWorkspace(query.data ?? [], wsId);

  useEffect(() => {
    if (current) void rememberWorkspace(current.id);
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
      <Screen safe={["top", "bottom"]} scroll={false}>
        <Spinner label="Loading workspace" size="large" style={styles.fill} />
      </Screen>
    );
  }
  if (query.isError) {
    return (
      <Screen safe={["top", "bottom"]} scroll={false}>
        <ErrorState style={styles.fill} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }
  if (query.data.length === 0) return <Redirect href="/onboarding/workspace" />;
  if (!current || !value) return <WorkspaceNotFound workspaces={query.data} />;

  const billingSetupRoute = `/w/${current.id}/setup/billing`;
  const billingRoute = `/w/${current.id}/billing`;
  if (
    requiresBillingSetup(current.subscriptionStatus) &&
    pathname !== billingSetupRoute &&
    pathname !== billingRoute
  ) {
    return <Redirect href={billingSetupRoute} />;
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return value;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { marginTop: spacing.sm },
  list: { gap: spacing.sm, marginTop: spacing.lg },
});
