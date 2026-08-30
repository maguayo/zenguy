import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { getBillingConfig } from "@/api/billing";
import { listMembers } from "@/api/members";
import { listWorkspaces } from "@/api/workspaces";
import { AuthShell } from "@/components/AuthShell";
import { webAppHost } from "@/components/more/billing";
import {
  stripeActivationTimeoutMessage,
  pollUntilActive,
  workspaceStatus,
} from "@/components/more/billing-setup";
import { PlanDetails } from "@/components/more/PlanDetails";
import { useToast } from "@/contexts/ToastContext";
import { requiresBillingSetup, useWorkspace } from "@/contexts/WorkspaceContext";
import { apiErrorMessage } from "@/lib/errors";
import { colors, palette, radius, spacing } from "@/theme";
import { Body, Button, Card, ErrorState, Muted, Screen, Small, Spinner } from "@/ui";

type ActivationPhase = "activating" | "idle" | "timeout";

function ActivationStatus({
  checking,
  onCheck,
  phase,
  timeoutMessage,
}: {
  checking: string;
  onCheck: () => void;
  phase: ActivationPhase;
  timeoutMessage: string;
}) {
  if (phase === "activating") {
    return (
      <View style={styles.info}>
        <Spinner label={checking} />
      </View>
    );
  }
  if (phase === "timeout") {
    return (
      <View style={styles.info}>
        <Small style={styles.infoText}>{timeoutMessage}</Small>
        <Button fullWidth style={styles.infoAction} title="Check again" onPress={onCheck} />
      </View>
    );
  }
  return null;
}

export default function BillingSetupScreen() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { current, role } = useWorkspace();
  const activationInFlight = useRef(false);
  const [phase, setPhase] = useState<ActivationPhase>("idle");
  const billingConfig = useQuery({ queryFn: getBillingConfig, queryKey: ["billing-config"] });
  const isOwner = role === "OWNER";
  const members = useQuery({
    enabled: billingConfig.data?.mode === "stripe" && !isOwner,
    queryFn: () => listMembers(current.id),
    queryKey: ["ws", current.id, "members"],
  });
  const owner = members.data?.find((member) => member.role === "OWNER");

  const checkActivation = useCallback(async () => {
    if (activationInFlight.current) return;
    activationInFlight.current = true;
    setPhase("activating");
    try {
      const active = await pollUntilActive(async () =>
        workspaceStatus(await listWorkspaces(), current.id),
      );
      if (!active) {
        setPhase("timeout");
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["ws", current.id, "billing"] }),
      ]);
      toast.success("Subscription active");
      router.replace(`/w/${current.id}/overview`);
    } catch (error) {
      setPhase("idle");
      toast.error(apiErrorMessage(error));
    } finally {
      activationInFlight.current = false;
    }
  }, [current.id, queryClient, router, toast]);

  // ACTIVE and PAST_DUE workspaces never need this screen.
  if (!requiresBillingSetup(current.subscriptionStatus)) {
    return <Redirect href={`/w/${current.id}/overview`} />;
  }

  if (billingConfig.isPending) {
    return (
      <Screen safe={["top", "bottom"]} scroll={false}>
        <Spinner label="Loading plan" size="large" style={styles.fill} />
      </Screen>
    );
  }
  if (billingConfig.isError) {
    return (
      <Screen safe={["top", "bottom"]} scroll={false}>
        <ErrorState style={styles.fill} onRetry={() => void billingConfig.refetch()} />
      </Screen>
    );
  }

  const reactivating = current.subscriptionStatus === "CANCELED";

  return (
    <AuthShell
      description={
        reactivating
          ? "Add a payment method to start scheduled runs again."
          : "Add a payment method to activate scheduled browser runs."
      }
      title={reactivating ? "Reactivate your workspace" : "Set up billing"}
    >
      <Card elevated padding="lg">
        <PlanDetails plan={billingConfig.data.plan} />
      </Card>
      <Card style={styles.webNote} tone="accent">
        {isOwner ? (
          <>
            <Body style={styles.webNoteTitle}>Complete billing setup on the web</Body>
            <Muted>
              {`Payment methods can't be added in the app. Sign in to the web app at ${webAppHost} to add one; this workspace activates automatically once the payment is confirmed.`}
            </Muted>
          </>
        ) : (
          <>
            <Body style={styles.webNoteTitle}>Only the workspace owner can set up billing.</Body>
            {members.isPending ? (
              <Spinner label="Loading workspace owner" />
            ) : owner ? (
              <Muted>
                Contact {owner.name} at {owner.email}.
              </Muted>
            ) : null}
          </>
        )}
      </Card>
      <View style={styles.actions}>
        <ActivationStatus
          checking="Checking activation…"
          phase={phase}
          timeoutMessage={stripeActivationTimeoutMessage}
          onCheck={() => void checkActivation()}
        />
        {phase === "idle" ? (
          <Button fullWidth title="Check activation" onPress={() => void checkActivation()} />
        ) : null}
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: spacing.xl },
  fill: { flex: 1 },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: palette.violetLine,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  infoAction: { marginTop: spacing.md },
  infoText: { color: colors.textBody },
  webNote: { marginTop: spacing.lg },
  webNoteTitle: { fontWeight: "500", marginBottom: spacing.xs },
});
