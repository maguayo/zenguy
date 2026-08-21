import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";

import type { Workspace } from "@/api/types";
import { listWorkspaces } from "@/api/workspaces";
import { useAuth } from "@/contexts/AuthContext";
import { lastWorkspaceId } from "@/contexts/WorkspaceContext";
import { workspaceHref } from "@/lib/links";
import { ErrorState, Screen, Spinner } from "@/ui";

export function pickWorkspace(workspaces: Workspace[], lastId: string | null): Workspace | undefined {
  return workspaces.find((item) => item.id === lastId) ?? workspaces[0];
}

/** Sends the user to the right place: sign-in, verification, onboarding or the last workspace. */
export default function RootResolver() {
  const { status, user } = useAuth();
  const [lastId, setLastId] = useState<string | null | undefined>(undefined);
  const workspaces = useQuery({
    enabled: status === "signedIn" && Boolean(user?.emailVerified),
    queryFn: listWorkspaces,
    queryKey: ["workspaces"],
  });

  useEffect(() => {
    let active = true;
    void lastWorkspaceId().then((value) => {
      if (active) setLastId(value);
    });
    return () => {
      active = false;
    };
  }, []);

  if (status === "signedOut") return <Redirect href="/(auth)/sign-in" />;
  if (status === "signedIn" && user && !user.emailVerified) return <Redirect href="/verify-pending" />;
  if (status !== "signedIn" || workspaces.isPending || lastId === undefined) {
    return (
      <Screen safe={["top", "bottom"]} scroll={false}>
        <Spinner label="Loading Zenguy" size="large" style={styles.fill} />
      </Screen>
    );
  }
  if (workspaces.isError) {
    return (
      <Screen safe={["top", "bottom"]} scroll={false}>
        <ErrorState style={styles.fill} onRetry={() => void workspaces.refetch()} />
      </Screen>
    );
  }
  const workspace = pickWorkspace(workspaces.data, lastId);
  if (!workspace) return <Redirect href="/onboarding/workspace" />;
  return <Redirect href={workspaceHref(workspace.id)} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
