import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
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
import {
  captureLinkCapability,
  forgetLinkCapability,
  linkCapability,
} from "@/lib/link-capabilities";
import { parseLinkFragment } from "@/lib/links";
import { localTimezone } from "@/lib/timezones";
import { spacing } from "@/theme";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  IconTile,
  Input,
  Muted,
  Screen,
  SelectSheet,
  Spinner,
} from "@/ui";

const continuationPath = "/grants/redeem";

export default function RedeemGrantScreen() {
  const params = useLocalSearchParams<{ "#"?: string; token?: string }>();
  const hasIncomingCapability = params.token !== undefined || params["#"] !== undefined;
  if (hasIncomingCapability) {
    return (
      <GrantCapabilityLink
        value={params.token ?? parseLinkFragment(params["#"])}
      />
    );
  }
  return <RedeemGrant token={linkCapability("grant")} />;
}

function GrantCapabilityLink({ value }: { value: unknown }) {
  const router = useRouter();
  const [token] = useState(() => captureLinkCapability("grant", value));

  useLayoutEffect(() => {
    Linking.clearInitialURL();
    router.replace(continuationPath);
  }, [router]);

  return <RedeemGrant token={token} />;
}

function RedeemGrant({ token }: { token: string | null }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [workspaceName, setWorkspaceName] = useState(() => defaultGrantWorkspaceName(user));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const signedIn = status === "signedIn";

  const grant = useQuery({
    enabled: signedIn && token !== null,
    gcTime: 0,
    queryFn: () => getSubscriptionGrant(token ?? ""),
    // The bearer remains in the query closure only while this page is mounted.
    queryKey: ["subscription-grant-link"],
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
      forgetLinkCapability("grant");
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Complimentary access is active");
      router.replace(`/w/${workspaceId}/overview`);
    },
  });

  const state = grantLinkState({
    error: grant.error,
    grant: grant.data,
    pending: grant.isPending,
    token,
  });
  useEffect(() => {
    if (state === "expired" || state === "unavailable") {
      forgetLinkCapability("grant");
    }
  }, [state]);

  if (status === "signedOut") {
    return (
      <Redirect
        href={{ params: { next: continuationPath }, pathname: "/(auth)/sign-in" }}
      />
    );
  }

  const eligible = complimentaryWorkspaces(workspaces.data ?? []);

  return (
    <Screen keyboard safe={["bottom"]}>
      {!signedIn ? (
        <Spinner label="Loading complimentary link" style={styles.fill} />
      ) : state === "unavailable" ? (
        <Card>
          <EmptyState
            description={unavailableGrantMessage}
            icon={<IconTile icon="gift" size={44} tone="warn" />}
            title="Link already used"
          />
        </Card>
      ) : state === "expired" ? (
        <Card>
          <EmptyState
            description={expiredGrantMessage}
            icon={<IconTile icon="clock" size={44} tone="warn" />}
            title="Link expired"
          />
        </Card>
      ) : state === "loading" ? (
        <Spinner label="Loading complimentary link" style={styles.fill} />
      ) : state === "error" ? (
        <ErrorState onRetry={() => void grant.refetch()} />
      ) : (
        <Card elevated title="Complimentary access">
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
              variant="accent"
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
