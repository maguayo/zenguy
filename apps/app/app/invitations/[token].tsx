import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { acceptInvitation, getInvitation } from "@/api/invitations";
import { invitationAccessMode, invitationRoleLabel } from "@/components/auth/invitation";
import { isExpiredLink } from "@/components/auth/link-errors";
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
    <AuthShell
      footer={
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.replace("/")}>
          <Label color={colors.accentDark}>Back to Zenguy</Label>
        </Pressable>
      }
      title="Invitation expired"
    >
      <Muted style={styles.center}>This invitation is no longer valid.</Muted>
    </AuthShell>
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
      <AuthShell title="Loading invitation">
        <Spinner label="Loading invitation" size="large" style={styles.spinner} />
      </AuthShell>
    );
  }

  if (invitation.isError) {
    return (
      <AuthShell title="Invitation">
        <ErrorState onRetry={() => void invitation.refetch()} />
      </AuthShell>
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
        <Card>
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
              title="Sign in to accept"
              variant="primary"
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
            title="Accept invitation"
            variant="primary"
            onPress={() => accept.mutate()}
          />
        ) : null}

        {mode === "different" && user ? (
          <View style={styles.stack}>
            <Card tone="warn">
              <Small color={colors.zinc700}>
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
  center: { textAlign: "center" },
  spinner: { minHeight: 96 },
  stack: { gap: spacing.lg },
});
