import { useEffect, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, UserPlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  changeRole,
  invite,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
} from "../../api/members";
import type { Invitation, Member, Role } from "../../api/types";
import { Badge, type BadgeProps } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dropdown, type DropdownItem } from "../../components/ui/Dropdown";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Table, type TableColumn } from "../../components/ui/Table";
import { fieldError } from "../../components/ui/form";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";
import { formatDateTime, formatRelative } from "../../lib/format";

const roleTone: Record<Role, NonNullable<BadgeProps["tone"]>> = {
  ADMIN: "info",
  MEMBER: "neutral",
  OWNER: "accent",
};

const roleLabel: Record<Role, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  OWNER: "Owner",
};

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={roleTone[role]}>{roleLabel[role]}</Badge>;
}

export interface MemberActionPolicy {
  canChangeRole: boolean;
  canRemove: boolean;
}

export function memberActionPolicy(
  actorRole: Role,
  actorUserId: string,
  target: Member,
): MemberActionPolicy {
  return {
    canChangeRole: actorRole === "OWNER" && target.role !== "OWNER",
    canRemove:
      actorRole === "OWNER"
        ? target.role !== "OWNER" && target.userId !== actorUserId
        : actorRole === "ADMIN" && target.role === "MEMBER",
  };
}

function MemberActions({ member }: { member: Member }) {
  const { user } = useAuth();
  const { current, role } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [removeOpen, setRemoveOpen] = useState(false);
  const policy = memberActionPolicy(role, user?.id ?? "", member);
  const updateRole = useMutation({
    mutationFn: (nextRole: "ADMIN" | "MEMBER") =>
      changeRole(current.id, member.userId, nextRole),
  });
  const remove = useMutation({
    mutationFn: () => removeMember(current.id, member.userId),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["ws", current.id, "members"] });

  const setRole = async (nextRole: "ADMIN" | "MEMBER") => {
    try {
      await updateRole.mutateAsync(nextRole);
      await refresh();
      toast.success(`${member.name} is now ${nextRole === "ADMIN" ? "an Admin" : "a Member"}`);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const removeCurrentMember = async () => {
    try {
      await remove.mutateAsync();
      await refresh();
      toast.success("Member removed");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const items: DropdownItem[] = [
    ...(policy.canChangeRole
      ? [
          {
            children: [
              {
                disabled: member.role === "ADMIN" || updateRole.isPending,
                label: "Admin",
                onSelect: () => void setRole("ADMIN"),
              },
              {
                disabled: member.role === "MEMBER" || updateRole.isPending,
                label: "Member",
                onSelect: () => void setRole("MEMBER"),
              },
            ],
            label: "Change role",
            onSelect: () => undefined,
          },
        ]
      : []),
    ...(policy.canRemove
      ? [
          {
            label: "Remove",
            onSelect: () => setRemoveOpen(true),
            separatorBefore: policy.canChangeRole,
            tone: "danger" as const,
          },
        ]
      : []),
  ];

  if (items.length === 0) return null;

  return (
    <>
      <Dropdown
        items={items}
        trigger={
          <IconButton aria-label={`Actions for ${member.name}`}>
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </IconButton>
        }
      />
      <ConfirmDialog
        body="They will lose access to this workspace."
        confirmLabel="Remove"
        onClose={() => setRemoveOpen(false)}
        onConfirm={removeCurrentMember}
        open={removeOpen}
        title={`Remove ${member.name} from this workspace?`}
        tone="danger"
      />
    </>
  );
}

export function memberColumns(
  timezone: string,
  renderActions?: (member: Member) => ReactNode,
): TableColumn<Member>[] {
  return [
    {
      header: "Member",
      key: "member",
      render: (member) => (
        <div className="min-w-52">
          <p className="font-medium text-zinc-900">{member.name}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{member.email}</p>
        </div>
      ),
    },
    {
      header: "Role",
      key: "role",
      render: (member) => <RoleBadge role={member.role} />,
    },
    {
      header: "Joined",
      key: "joined",
      render: (member) => (
        <span className="whitespace-nowrap">{formatDateTime(member.joinedAt, timezone)}</span>
      ),
    },
    {
      className: "w-12 text-right",
      header: <span className="sr-only">Actions</span>,
      key: "actions",
      render: (member) => renderActions?.(member) ?? null,
    },
  ];
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email address."),
  role: z.enum(["ADMIN", "MEMBER"]),
});

type InviteValues = z.infer<typeof inviteSchema>;

function InviteMemberModal({ onClose, open }: { onClose: () => void; open: boolean }) {
  const { can, current } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useForm<InviteValues>({
    defaultValues: { email: "", role: "MEMBER" },
    mode: "onChange",
    resolver: zodResolver(inviteSchema),
  });
  const send = useMutation({
    mutationFn: (values: InviteValues) =>
      invite(current.id, { email: values.email.trim().toLowerCase(), role: values.role }),
  });

  useEffect(() => {
    if (open) {
      form.reset({ email: "", role: "MEMBER" });
      send.reset();
    }
  }, [form, open]);

  const close = () => {
    if (!send.isPending) {
      form.reset({ email: "", role: "MEMBER" });
      onClose();
    }
  };

  const submit = form.handleSubmit(async (values) => {
    try {
      const email = values.email.trim().toLowerCase();
      await send.mutateAsync({ ...values, email });
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "invitations"] });
      toast.success(`Invitation sent to ${email}`);
      form.reset({ email: "", role: "MEMBER" });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        form.setError("email", { message: "Already a member." });
        return;
      }
      const message = apiErrorMessage(error);
      form.setError("root", { message });
      toast.error(message);
    }
  });
  const rootError = form.formState.errors.root?.message;

  return (
    <Modal
      footer={
        <>
          <Button disabled={send.isPending} onClick={close}>Cancel</Button>
          <Button form="invite-member-form" loading={send.isPending} type="submit" variant="primary">
            Send invitation
          </Button>
        </>
      }
      onClose={close}
      open={open}
      title="Invite member"
    >
      <form className="space-y-4" id="invite-member-form" noValidate onSubmit={(event) => void submit(event)}>
        <Field
          error={fieldError(form.formState, "email")}
          htmlFor="invite-email"
          label="Email"
          required
        >
          <Input
            autoComplete="email"
            id="invite-email"
            invalid={Boolean(fieldError(form.formState, "email"))}
            placeholder="teammate@example.com"
            type="email"
            {...form.register("email")}
          />
        </Field>
        <Field htmlFor="invite-role" label="Role" required>
          <Select id="invite-role" {...form.register("role")}>
            <option value="MEMBER">Member</option>
            {can("admins.manage") ? <option value="ADMIN">Admin</option> : null}
          </Select>
        </Field>
        {rootError ? (
          <p className="rounded-md bg-danger-50 p-3 text-sm text-danger-700" role="alert">
            {rootError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function PendingInvitations({ invitations }: { invitations: Invitation[] }) {
  const { current } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const revoke = useMutation({
    mutationFn: (invitationId: string) => revokeInvitation(current.id, invitationId),
  });

  const revokePending = async (invitationId: string) => {
    try {
      await revoke.mutateAsync(invitationId);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "invitations"] });
      toast.success("Invitation revoked");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const columns: TableColumn<Invitation>[] = [
    { header: "Email", key: "email", render: (item) => <span className="font-medium">{item.email}</span> },
    { header: "Role", key: "role", render: (item) => <RoleBadge role={item.role} /> },
    {
      header: "Invited by",
      key: "invitedBy",
      render: (item) => `Invited by ${item.invitedBy?.name ?? "System"}`,
    },
    {
      header: "Expires",
      key: "expires",
      render: (item) => <span className="whitespace-nowrap">Expires {formatRelative(item.expiresAt)}</span>,
    },
    {
      className: "text-right",
      header: <span className="sr-only">Actions</span>,
      key: "actions",
      render: (item) => (
        <Button
          loading={revoke.isPending && revoke.variables === item.id}
          size="sm"
          variant="ghost"
          onClick={() => void revokePending(item.id)}
        >
          Revoke
        </Button>
      ),
    },
  ];

  return (
    <Card padding="none">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">Pending invitations</h2>
      </div>
      <Table columns={columns} rowKey={(item) => item.id} rows={invitations} />
    </Card>
  );
}

export default function MembersPage() {
  const { can, current, timezone } = useWorkspace();
  const [inviteOpen, setInviteOpen] = useState(false);
  const members = useQuery({
    queryFn: () => listMembers(current.id),
    queryKey: ["ws", current.id, "members"],
  });
  const invitations = useQuery({
    enabled: can("members.invite"),
    queryFn: () => listInvitations(current.id),
    queryKey: ["ws", current.id, "invitations"],
  });
  const columns = memberColumns(timezone, (member) => <MemberActions member={member} />);
  const inviteButton = can("members.invite") ? (
    <Button onClick={() => setInviteOpen(true)} variant="primary">
      <Plus aria-hidden="true" className="size-4" />
      Invite member
    </Button>
  ) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        actions={inviteButton}
        description="Members are unlimited and free."
        title="Members"
      />

      {members.isError ? (
        <ErrorState onRetry={() => void members.refetch()} />
      ) : (
        <Card padding="none">
          <Table
            columns={columns}
            empty={
              <EmptyState
                action={inviteButton}
                className="m-4"
                icon={<UserPlus aria-hidden="true" className="size-7" />}
                title="No members yet"
              />
            }
            loading={members.isPending}
            rowKey={(member) => member.userId}
            rows={members.data ?? []}
          />
        </Card>
      )}

      {can("members.invite") && invitations.isError ? (
        <ErrorState onRetry={() => void invitations.refetch()} />
      ) : invitations.data && invitations.data.length > 0 ? (
        <PendingInvitations invitations={invitations.data} />
      ) : null}

      <InviteMemberModal onClose={() => setInviteOpen(false)} open={inviteOpen} />
    </div>
  );
}
