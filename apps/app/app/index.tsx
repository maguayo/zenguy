import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";

import { listWorkspaces } from "@/api/workspaces";
import { useAuth } from "@/contexts/AuthContext";
import { lastWorkspaceId, pickMobileWorkspace } from "@/contexts/WorkspaceContext";
import { workspaceHref } from "@/lib/links";
import { ErrorState, Screen, Spinner } from "@/ui";

/** Sends an existing account to sign-in, its workspace, or a neutral access state. */
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
  if (status === "signedIn" && user && !user.emailVerified) {
    return <Redirect href="/access-unavailable" />;
  }
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
  const workspace = pickMobileWorkspace(workspaces.data, lastId);
  if (!workspace) return <Redirect href="/access-unavailable" />;
  return <Redirect href={workspaceHref(workspace.id)} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
