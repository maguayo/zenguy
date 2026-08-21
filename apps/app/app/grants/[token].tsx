import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  complimentaryWorkspaces,
  getSubscriptionGrant,
  redeemSubscriptionGrant,
} from "@/api/grants";
import { createWorkspace, listWorkspaces } from "@/api/workspaces";
import {
  defaultGrantWorkspaceName,
  expiredGrantMessage,
  grantLinkState,
  newWorkspaceHint,
  redeemDescription,
  unavailableGrantMessage,
} from "@/components/more/grants";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { apiErrorMessage } from "@/lib/errors";
import { parseLinkToken } from "@/lib/links";
import { localTimezone } from "@/lib/timezones";
import { spacing } from "@/theme";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Muted,
  Screen,
  SelectSheet,
  Spinner,
} from "@/ui";

export default function RedeemGrantScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const token = parseLinkToken(params.token);
  const { status, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [workspaceName, setWorkspaceName] = useState(() => defaultGrantWorkspaceName(user));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const signedIn = status === "signedIn";

  const grant = useQuery({
    enabled: signedIn && token !== null,
    queryFn: () => getSubscriptionGrant(token ?? ""),
    queryKey: ["subscription-grant", token],
  });
  const workspaces = useQuery({
    enabled: signedIn,
    queryFn: listWorkspaces,
    queryKey: ["workspaces"],
  });

  const redeem = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error(unavailableGrantMessage);
      let workspaceId = selectedId ?? "";
      const eligible = complimentaryWorkspaces(workspaces.data ?? []);
      if (workspaceId === "" && eligible[0]) workspaceId = eligible[0].id;
      if (workspaceId === "") {
        const created = await createWorkspace({
          name: workspaceName.trim() || "Complimentary workspace",
          timezone: localTimezone(),
        });
        workspaceId = created.id;
      }
      return redeemSubscriptionGrant(token, workspaceId);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
    onSuccess: async ({ workspaceId }) => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Complimentary access is active");
      router.replace(`/w/${workspaceId}/overview`);
    },
  });

  if (status === "signedOut") {
    return <Redirect href={{ params: { next: pathname }, pathname: "/(auth)/sign-in" }} />;
  }

  const state = grantLinkState({
    error: grant.error,
    grant: grant.data,
    pending: grant.isPending,
    token,
  });
  const eligible = complimentaryWorkspaces(workspaces.data ?? []);

  return (
    <Screen keyboard safe={["bottom"]}>
      {!signedIn ? (
        <Spinner label="Loading complimentary link" style={styles.fill} />
      ) : state === "unavailable" ? (
        <Card>
          <EmptyState description={unavailableGrantMessage} title="Link already used" />
        </Card>
      ) : state === "expired" ? (
        <Card>
          <EmptyState description={expiredGrantMessage} title="Link expired" />
        </Card>
      ) : state === "loading" ? (
        <Spinner label="Loading complimentary link" style={styles.fill} />
      ) : state === "error" ? (
        <ErrorState onRetry={() => void grant.refetch()} />
      ) : (
        <Card title="Complimentary access">
          <View style={styles.form}>
            <Muted>{redeemDescription}</Muted>
            {workspaces.isPending ? (
              <Spinner label="Loading workspaces" />
            ) : workspaces.isError ? (
              <ErrorState onRetry={() => void workspaces.refetch()} />
            ) : eligible.length > 0 ? (
              <Field label="Workspace">
                <SelectSheet
                  options={eligible.map((workspace) => ({
                    label: workspace.name,
                    value: workspace.id,
                  }))}
                  title="Workspace"
                  value={selectedId ?? eligible[0]?.id ?? null}
                  onChange={setSelectedId}
                />
              </Field>
            ) : (
              <Field hint={newWorkspaceHint} label="New workspace name">
                <Input
                  autoComplete="organization"
                  returnKeyType="done"
                  value={workspaceName}
                  onChangeText={setWorkspaceName}
                />
              </Field>
            )}
            <Button
              disabled={workspaces.isPending || workspaces.isError}
              fullWidth
              loading={redeem.isPending}
              size="lg"
              title="Activate complimentary access"
              variant="primary"
              onPress={() => redeem.mutate()}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  form: { gap: spacing.lg },
});
