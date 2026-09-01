import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  getRemoteAiConsent,
  grantRemoteAiConsent,
  revokeRemoteAiConsent,
} from "@/api/remote-ai-consent";
import { toHref } from "@/components/more/links";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { apiErrorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useMutationError } from "@/hooks/useMutationError";
import { colors, spacing } from "@/theme";
import {
  Badge,
  Body,
  Button,
  Card,
  confirm,
  ErrorState,
  Label,
  Muted,
  Screen,
  Small,
  Spinner,
  Toggle,
} from "@/ui";

const DATA_CATEGORIES = [
  "Test name, instructions, target URLs, and device configuration",
  "Relevant page content, screenshots, console output, and network results",
  "Model output used to perform steps and determine the test result",
] as const;

export default function AiDataSharingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current, timezone } = useWorkspace();
  const [affirmed, setAffirmed] = useState(false);
  const queryKey = ["ws", current.id, "remote-ai-consent"] as const;
  const consent = useQuery({
    queryKey,
    queryFn: () => getRemoteAiConsent(current.id),
  });
  const grant = useMutation({ mutationFn: () => grantRemoteAiConsent(current.id) });
  const revoke = useMutation({ mutationFn: () => revokeRemoteAiConsent(current.id) });

  if (!can("workspace.settings")) {
    return <Redirect href={`/w/${current.id}/more`} />;
  }

  const enable = async () => {
    if (!affirmed) return;
    try {
      const next = await grant.mutateAsync();
      queryClient.setQueryData(queryKey, next);
      setAffirmed(false);
      toast.success("Optional OpenAI processing enabled");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const disable = async () => {
    const accepted = await confirm({
      confirmLabel: "Revoke consent",
      destructive: true,
      message:
        "Future runs will stay on Zenguy's private runner. A run that already started may finish.",
      title: "Revoke OpenAI consent?",
    });
    if (!accepted) return;
    try {
      await revoke.mutateAsync();
      await queryClient.invalidateQueries({ queryKey });
      toast.success("OpenAI consent revoked");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "AI data sharing" }} />
      <Screen>
        <View style={styles.stack}>
          <Card elevated title="Optional remote processing">
            <Badge dot tone={consent.data?.active ? "ok" : "neutral"}>
              {consent.data?.active ? "Enabled" : "Off by default"}
            </Badge>
            <Muted style={styles.intro}>
              Zenguy normally sends runs to its private local runner. Test data is not sent
              to OpenAI unless an Owner or Admin gives the workspace consent here.
            </Muted>
          </Card>

          <Card title="What changes if you consent">
            <Body>
              If the private runner is unavailable, Zenguy may use OpenAI as an optional
              fallback to execute browser-test steps. The following data may be shared:
            </Body>
            <View style={styles.categories}>
              {DATA_CATEGORIES.map((category) => (
                <View key={category} style={styles.category}>
                  <Label color={colors.accentDark}>•</Label>
                  <Small style={styles.categoryText}>{category}</Small>
                </View>
              ))}
            </View>
            <Muted>
              Account, member, billing, and notification data are not sent for this
              purpose. Consent applies to this workspace and can be revoked at any time.
            </Muted>
            <Muted>
              Configured secret values stay in Zenguy and are never disclosed to
              OpenAI. Remote runs receive only the placeholder names used by a test.
            </Muted>
            <Button
              title="Read the privacy policy"
              variant="ghost"
              onPress={() => router.push(toHref("/privacy"))}
            />
          </Card>

          {consent.isPending ? (
            <Spinner label="Loading consent" />
          ) : consent.isError ? (
            <ErrorState onRetry={() => void consent.refetch()} />
          ) : consent.data.active ? (
            <Card title="Workspace consent" tone="danger">
              <Body>OpenAI fallback processing is currently allowed.</Body>
              {consent.data.acceptedAt ? (
                <Muted>
                  Accepted {formatDateTime(consent.data.acceptedAt, timezone)} · policy {consent.data.policyVersion}
                </Muted>
              ) : null}
              <Button
                loading={revoke.isPending}
                title="Revoke consent"
                variant="danger"
                onPress={() => void disable()}
              />
            </Card>
          ) : (
            <Card title="Give consent">
              <Toggle
                description="This switch starts off and is never enabled automatically."
                label="I understand and consent to the OpenAI data sharing described above"
                value={affirmed}
                onValueChange={setAffirmed}
              />
              <Button
                disabled={!affirmed}
                loading={grant.isPending}
                title="Enable optional OpenAI fallback"
                variant="accent"
                onPress={() => void enable()}
              />
            </Card>
          )}
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  categories: { gap: spacing.sm },
  category: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  categoryText: { flex: 1 },
  intro: { marginTop: spacing.md },
  stack: { gap: spacing.xl },
});
