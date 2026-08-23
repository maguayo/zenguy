import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { getBillingConfig } from "@/api/billing";
import {
  issueSubscriptionGrant,
  listSubscriptionGrants,
  type IssuedSubscriptionGrant,
} from "@/api/grants";
import { CopyButton } from "@/components/CopyButton";
import { AccessDenied } from "@/components/more/AccessDenied";
import { issueDescription, issuedGrantSummary } from "@/components/more/grants";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { colors, radius, spacing } from "@/theme";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  IconTile,
  Input,
  ListRow,
  Mono,
  Muted,
  Screen,
  Spinner,
} from "@/ui";

const accessDeniedMessage = "You cannot issue complimentary subscription links.";

export default function ComplimentaryLinksScreen() {
  const { status } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [latest, setLatest] = useState<IssuedSubscriptionGrant>();
  const signedIn = status === "signedIn";
  const config = useQuery({
    enabled: signedIn,
    queryFn: getBillingConfig,
    queryKey: ["billing-config"],
  });
  const allowed = config.data?.canIssueComplimentaryGrants === true;
  const grants = useQuery({
    enabled: allowed,
    queryFn: listSubscriptionGrants,
    queryKey: ["subscription-grants"],
  });
  const issue = useMutation({
    mutationFn: () => issueSubscriptionGrant(note.trim() || undefined),
    onError: (error) => toast.error(apiErrorMessage(error)),
    onSuccess: async (issued) => {
      setLatest(issued);
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["subscription-grants"] });
      toast.success("Complimentary link created");
    },
  });

  if (status === "signedOut") return <Redirect href="/(auth)/sign-in" />;

  return (
    <Screen
      keyboard
      refreshing={allowed && grants.isRefetching && !grants.isPending}
      safe={["bottom"]}
      onRefresh={allowed ? () => void grants.refetch() : undefined}
    >
      {!signedIn || config.isPending ? (
        <Spinner label="Loading complimentary access" style={styles.fill} />
      ) : config.isError ? (
        <ErrorState onRetry={() => void config.refetch()} />
      ) : !allowed ? (
        <AccessDenied message={accessDeniedMessage} />
      ) : (
        <View style={styles.stack}>
          <Muted>{issueDescription}</Muted>
          <Card elevated title="New link">
            <Field hint="Optional. Visible only to you." label="Note">
              <Input
                maxLength={200}
                placeholder="Influencer, friend, internal…"
                returnKeyType="done"
                value={note}
                onChangeText={setNote}
              />
            </Field>
            <Button
              loading={issue.isPending}
              style={styles.gapTop}
              title="Create one-time link"
              variant="accent"
              onPress={() => issue.mutate()}
            />
            {latest ? (
              <View style={styles.latest}>
                <Mono color={colors.accentInk} numberOfLines={1} selectable style={styles.latestUrl}>
                  {latest.redeemUrl}
                </Mono>
                <CopyButton label="Copy link" text={latest.redeemUrl} />
              </View>
            ) : null}
          </Card>
          <Card eyebrow="Issued links" padding="none">
            {grants.isPending ? (
              <Spinner label="Loading issued links" />
            ) : grants.isError ? (
              grants.error instanceof ApiError && grants.error.status === 403 ? (
                <AccessDenied message={accessDeniedMessage} />
              ) : (
                <ErrorState onRetry={() => void grants.refetch()} />
              )
            ) : grants.data.length === 0 ? (
              <EmptyState
                description="Links you create appear here with their status."
                icon={<IconTile icon="gift" size={44} />}
                title="No links issued yet."
              />
            ) : (
              grants.data.map((grant, index) => (
                <ListRow
                  key={grant.id}
                  left={<IconTile icon="gift" tone={grant.redeemedAt ? "plain" : "ok"} />}
                  right={
                    <Badge tone={grant.redeemedAt ? "neutral" : "ok"}>
                      {grant.redeemedAt ? "Used" : "Unused"}
                    </Badge>
                  }
                  style={index === grants.data.length - 1 ? styles.lastRow : undefined}
                  subtitle={issuedGrantSummary(grant)}
                  title={grant.note ?? "Untitled"}
                />
              ))
            )}
          </Card>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gapTop: { marginTop: spacing.lg },
  lastRow: { borderBottomWidth: 0 },
  latest: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentSofter,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  latestUrl: { flex: 1 },
  stack: { gap: spacing.lg },
});
