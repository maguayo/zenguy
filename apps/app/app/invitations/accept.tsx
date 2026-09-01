import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { acceptInvitation, getInvitation } from "@/api/invitations";
import { invitationAccessMode, invitationRoleLabel } from "@/components/auth/invitation";
import { isExpiredLink } from "@/components/auth/link-errors";
import { AuthStatus } from "@/components/auth/AuthStatus";
import { AuthShell } from "@/components/AuthShell";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { apiErrorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import {
  captureLinkCapability,
  forgetLinkCapability,
  linkCapability,
} from "@/lib/link-capabilities";
import { parseLinkFragment } from "@/lib/links";
import { localTimezone } from "@/lib/timezones";
import { colors, spacing } from "@/theme";
import { Button, Card, DescriptionList, ErrorState, Label, Muted, Small, Spinner } from "@/ui";

const continuationPath = "/invitations/accept";

function InvitationExpired() {
  const router = useRouter();
  return (
    <AuthStatus
      description="This invitation is no longer valid."
      footer={
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.replace("/")}>
          <Label color={colors.accentDark}>Back to Zenguy</Label>
        </Pressable>
      }
      icon="clock"
      title="Invitation expired"
      tone="warn"
    />
  );
}

function Invitation({ token }: { token: string }) {
  const { signOut, status, user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const invitation = useQuery({
    gcTime: 0,
    queryFn: () => getInvitation(token),
    // Never copy a bearer into React Query's cache keys or development tools.
    queryKey: ["invitation-link"],
  });

  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onError: (error) => toast.error(apiErrorMessage(error)),
    onSuccess: async ({ workspaceId }) => {
      forgetLinkCapability("invitation");
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success(`Welcome to ${invitation.data?.workspaceName ?? "your workspace"}`);
      router.replace(`/w/${workspaceId}/overview`);
    },
  });

  useEffect(() => {
    if (invitation.isError && isExpiredLink(invitation.error)) {
      forgetLinkCapability("invitation");
    }
  }, [invitation.error, invitation.isError]);

  if (invitation.isError && isExpiredLink(invitation.error)) return <InvitationExpired />;

  if (invitation.isPending || status === "loading") {
    return (
      <AuthStatus icon="users" title="Loading invitation">
        <Spinner label="Loading invitation" size="large" style={styles.spinner} />
      </AuthStatus>
    );
  }

  if (invitation.isError) {
    return (
      <AuthStatus icon="users" title="Invitation" tone="warn">
        <ErrorState onRetry={() => void invitation.refetch()} />
      </AuthStatus>
    );
  }

  const details = invitation.data;
  const mode = invitationAccessMode(details, status === "signedIn" ? user : null);
  const role = invitationRoleLabel(details.role);

  return (
    <AuthShell
      description={`${details.inviterName} invited you to join “${details.workspaceName}” as ${role}.`}
      title="Workspace invitation"
    >
      <View style={styles.stack}>
        <Card elevated>
          <DescriptionList
            items={[
              { label: "Workspace", value: details.workspaceName },
              { label: "Invited by", value: details.inviterName },
              { label: "Role", value: role },
              { label: "Expires", value: formatDateTime(details.expiresAt, localTimezone()) },
            ]}
          />
        </Card>

        {mode === "signedOut" ? (
          <View style={styles.stack}>
            <Muted>Sign in as {details.email} to accept this invitation.</Muted>
            <Button
              fullWidth
              size="lg"
              title="Sign in to accept"
              variant="accent"
              onPress={() =>
                router.push({
                  params: { next: continuationPath },
                  pathname: "/(auth)/sign-in",
                })
              }
            />
            <Muted>
              Invitations can only be accepted by an existing Zenguy account.
            </Muted>
          </View>
        ) : null}

        {mode === "matching" ? (
          <Button
            fullWidth
            loading={accept.isPending}
            size="lg"
            title="Accept invitation"
            variant="accent"
            onPress={() => accept.mutate()}
          />
        ) : null}

        {mode === "different" && user ? (
          <View style={styles.stack}>
            <Card tone="warn">
              <Small color={colors.textBody}>
                This invitation was sent to {details.email}. You&apos;re signed in as {user.email}.
              </Small>
            </Card>
            <Button fullWidth title="Sign out" onPress={() => void signOut()} />
          </View>
        ) : null}
      </View>
    </AuthShell>
  );
}

export default function AcceptInvitationScreen() {
  const params = useLocalSearchParams<{ "#"?: string; token?: string }>();
  const hasIncomingCapability = params.token !== undefined || params["#"] !== undefined;
  if (hasIncomingCapability) {
    return (
      <InvitationCapabilityLink
        value={params.token ?? parseLinkFragment(params["#"])}
      />
    );
  }
  const token = linkCapability("invitation");
  if (!token) return <InvitationExpired />;
  return <Invitation token={token} />;
}

function InvitationCapabilityLink({ value }: { value: unknown }) {
  const router = useRouter();
  const [token] = useState(() => captureLinkCapability("invitation", value));

  useLayoutEffect(() => {
    Linking.clearInitialURL();
    router.replace(continuationPath);
  }, [router]);

  if (!token) return <InvitationExpired />;
  return <Invitation token={token} />;
}

const styles = StyleSheet.create({
  spinner: { minHeight: 96 },
  stack: { gap: spacing.lg },
});
