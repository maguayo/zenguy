import { useState } from "react";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";

import {
  changeRole,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
} from "@/api/members";
import type { Invitation, Member } from "@/api/types";
import { InviteForm } from "@/components/members/InviteForm";
import {
  assignableRoles,
  memberActionPolicy,
  removeMemberTitle,
  removeMemberWarning,
  roleChangedMessage,
  roleLabel,
  type AssignableRole,
} from "@/components/members/member-policy";
import { RoleBadge } from "@/components/RoleBadge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { apiErrorMessage } from "@/lib/errors";
import { formatDateTime, formatRelative } from "@/lib/format";
import { colors, spacing } from "@/theme";
import {
  ActionMenu,
  Button,
  Caption,
  Card,
  confirm,
  EmptyState,
  ErrorState,
  ListRow,
  Muted,
  Screen,
  showActionMenu,
  Skeleton,
  Spinner,
  type ActionMenuItem,
} from "@/ui";

function MemberActions({ member }: { member: Member }) {
  const { user } = useAuth();
  const { current, role } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const policy = memberActionPolicy(role, user?.id ?? "", member);
  const updateRole = useMutation({
    mutationFn: (nextRole: AssignableRole) => changeRole(current.id, member.userId, nextRole),
  });
  const remove = useMutation({
    mutationFn: () => removeMember(current.id, member.userId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ws", current.id, "members"] });

  const setRole = async (nextRole: AssignableRole) => {
    try {
      await updateRole.mutateAsync(nextRole);
      await refresh();
      toast.success(roleChangedMessage(member.name, nextRole));
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const removeCurrentMember = async () => {
    const confirmed = await confirm({
      confirmLabel: "Remove",
      destructive: true,
      message: removeMemberWarning,
      title: removeMemberTitle(member),
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync();
      await refresh();
      toast.success("Member removed");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const items: ActionMenuItem[] = [
    ...(policy.canChangeRole
      ? [
          {
            label: "Change role",
            onSelect: () =>
              showActionMenu(
                assignableRoles.map((nextRole) => ({
                  disabled: member.role === nextRole || updateRole.isPending,
                  label: roleLabel[nextRole],
                  onSelect: () => void setRole(nextRole),
                })),
                `Change role for ${member.name}`,
              ),
          },
        ]
      : []),
    ...(policy.canRemove
      ? [{ destructive: true, label: "Remove", onSelect: () => void removeCurrentMember() }]
      : []),
  ];

  if (items.length === 0) return null;

  return <ActionMenu accessibilityLabel={`Actions for ${member.name}`} items={items} title={member.name} />;
}

function PendingInvitations({ invitations }: { invitations: Invitation[] }) {
  const { current } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const revoke = useMutation({
    mutationFn: (invitationId: string) => revokeInvitation(current.id, invitationId),
  });

  const revokePending = async (invitation: Invitation) => {
    const confirmed = await confirm({
      confirmLabel: "Revoke",
      destructive: true,
      message: "They will no longer be able to join with this invitation.",
      title: `Revoke the invitation to ${invitation.email}?`,
    });
    if (!confirmed) return;
    try {
      await revoke.mutateAsync(invitation.id);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "invitations"] });
      toast.success("Invitation revoked");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  return (
    <Card padding="none" title="Pending invitations">
      {invitations.map((invitation, index) => (
        <ListRow
          key={invitation.id}
          right={
            <View style={styles.rowRight}>
              <RoleBadge role={invitation.role} />
              <Button
                loading={revoke.isPending && revoke.variables === invitation.id}
                size="sm"
                title="Revoke"
                variant="ghost"
                onPress={() => void revokePending(invitation)}
              />
            </View>
          }
          style={index === invitations.length - 1 && styles.lastRow}
          subtitle={
            <View style={styles.meta}>
              <Caption>Invited by {invitation.invitedBy?.name ?? "System"}</Caption>
              <Caption>Expires {formatRelative(invitation.expiresAt)}</Caption>
            </View>
          }
          title={invitation.email}
        />
      ))}
    </Card>
  );
}

export default function MembersScreen() {
  const { can, current, timezone } = useWorkspace();
  const canInvite = can("members.invite");
  const [inviteOpen, setInviteOpen] = useState(false);
  const members = useQuery({
    queryFn: () => listMembers(current.id),
    queryKey: ["ws", current.id, "members"],
  });
  const invitations = useQuery({
    enabled: canInvite,
    queryFn: () => listInvitations(current.id),
    queryKey: ["ws", current.id, "invitations"],
  });

  const refreshing =
    (members.isRefetching && !members.isPending) ||
    (invitations.isRefetching && !invitations.isPending);
  const refresh = () => {
    void members.refetch();
    if (canInvite) void invitations.refetch();
  };

  const inviteButton = canInvite ? (
    <Button
      icon={<Feather color={colors.white} name="plus" size={16} />}
      title="Invite member"
      variant="primary"
      onPress={() => setInviteOpen(true)}
    />
  ) : undefined;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: canInvite
            ? () => <Button size="sm" title="Invite" variant="ghost" onPress={() => setInviteOpen(true)} />
            : undefined,
          title: "Members",
        }}
      />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <View style={styles.stack}>
          <Muted>Members are unlimited and free.</Muted>

          {members.isPending ? (
            <Spinner label="Loading members" />
          ) : members.isError ? (
            <ErrorState onRetry={() => void members.refetch()} />
          ) : (
            <Card padding="none">
              {members.data.length === 0 ? (
                <EmptyState
                  action={inviteButton}
                  icon={<Feather color={colors.zinc400} name="user-plus" size={24} />}
                  title="No members yet"
                />
              ) : (
                members.data.map((member, index) => (
                  <ListRow
                    key={member.userId}
                    right={
                      <View style={styles.rowRight}>
                        <RoleBadge role={member.role} />
                        <MemberActions member={member} />
                      </View>
                    }
                    style={index === members.data.length - 1 && styles.lastRow}
                    subtitle={
                      <View style={styles.meta}>
                        <Muted numberOfLines={1}>{member.email}</Muted>
                        <Caption>Joined {formatDateTime(member.joinedAt, timezone)}</Caption>
                      </View>
                    }
                    title={member.name}
                  />
                ))
              )}
            </Card>
          )}

          {canInvite && invitations.isPending ? (
            <Card title="Pending invitations">
              <View accessibilityLabel="Loading pending invitations" style={styles.skeletons}>
                <Skeleton />
                <Skeleton width="80%" />
              </View>
            </Card>
          ) : canInvite && invitations.isError ? (
            <ErrorState onRetry={() => void invitations.refetch()} />
          ) : invitations.data && invitations.data.length > 0 ? (
            <PendingInvitations invitations={invitations.data} />
          ) : null}
        </View>
      </Screen>

      <InviteForm open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  lastRow: { borderBottomWidth: 0 },
  meta: { gap: 2 },
  rowRight: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  skeletons: { gap: spacing.sm + 2 },
  stack: { gap: spacing.lg },
});
