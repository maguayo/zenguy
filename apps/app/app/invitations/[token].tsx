import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { parseLinkToken } from "@/lib/links";
import { localTimezone } from "@/lib/timezones";
import { colors, spacing } from "@/theme";
import { Button, Card, DescriptionList, ErrorState, Label, Muted, Small, Spinner } from "@/ui";

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
    queryFn: () => getInvitation(token),
    queryKey: ["invitation", token],
  });

  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onError: (error) => toast.error(apiErrorMessage(error)),
    onSuccess: async ({ workspaceId }) => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success(`Welcome to ${invitation.data?.workspaceName ?? "your workspace"}`);
      router.replace(`/w/${workspaceId}/overview`);
    },
  });

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
                  params: { next: `/invitations/${token}` },
                  pathname: "/(auth)/sign-in",
                })
              }
            />
            <Button fullWidth title="Create an account" onPress={() => router.push("/(auth)/sign-up")} />
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
  const params = useLocalSearchParams<{ token: string }>();
  // Only a well-formed token is ever sent to the API.
  const token = parseLinkToken(params.token);
  if (!token) return <InvitationExpired />;
  return <Invitation token={token} />;
}

const styles = StyleSheet.create({
  spinner: { minHeight: 96 },
  stack: { gap: spacing.lg },
});
