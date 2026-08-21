import { Feather } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, View } from "react-native";

import { listMembers } from "@/api/members";
import type { AuditEntry, Workspace } from "@/api/types";
import {
  deleteWorkspace,
  listAuditLogs,
  transferOwnership,
  updateWorkspace,
} from "@/api/workspaces";
import { FormError } from "@/components/FormError";
import {
  auditActorName,
  auditResourceLabel,
  canConfirmDeletion,
  deleteWorkspaceDescription,
  deleteWorkspaceWarning,
  prettyAuditMetadata,
  transferCandidates,
  transferOwnershipDescription,
  workspaceSettingsSchema,
  type WorkspaceSettingsValues,
} from "@/components/more/settings";
import { TimezonePicker } from "@/components/TimezonePicker";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { ApiError, type ApiPage } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { secureStorage, storageKeys } from "@/lib/secure-storage";
import { timezoneLabel } from "@/lib/timezones";
import { colors, spacing } from "@/theme";
import {
  Body,
  Button,
  Caption,
  Card,
  confirm,
  DescriptionList,
  Divider,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadMore,
  Mono,
  Muted,
  Screen,
  SelectSheet,
  Small,
  Spinner,
} from "@/ui";

function GeneralCard({ workspace }: { workspace: Workspace }) {
  const { can } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const form = useForm<WorkspaceSettingsValues>({
    defaultValues: { name: workspace.name, timezone: workspace.timezone },
    resolver: zodResolver(workspaceSettingsSchema),
  });
  const save = useMutation({
    mutationFn: (values: WorkspaceSettingsValues) => updateWorkspace(workspace.id, values),
  });

  useEffect(() => {
    form.reset({ name: workspace.name, timezone: workspace.timezone });
  }, [form, workspace.id, workspace.name, workspace.timezone]);

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      await save.mutateAsync(values);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["ws", workspace.id, "audit"] }),
      ]);
      toast.success("Workspace settings saved");
    } catch (error) {
      if (handleMutationError(error)) return;
      if (error instanceof ApiError && error.details?.length) {
        let handled = false;
        for (const detail of error.details) {
          if (detail.field === "name" || detail.field === "timezone") {
            form.setError(detail.field, { message: detail.message });
            handled = true;
          }
        }
        if (handled) return;
      }
      form.setError("root", { message: apiErrorMessage(error) });
    }
  });

  if (!can("workspace.settings")) {
    return (
      <Card title="General">
        <DescriptionList
          items={[
            { label: "Name", value: workspace.name },
            { label: "Timezone", value: timezoneLabel(workspace.timezone) },
          ]}
        />
      </Card>
    );
  }

  return (
    <Card title="General">
      <View style={styles.form}>
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field error={fieldState.error?.message} label="Name" required>
              <Input
                autoComplete="organization"
                invalid={Boolean(fieldState.error)}
                returnKeyType="done"
                value={field.value}
                onBlur={field.onBlur}
                onChangeText={field.onChange}
              />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="timezone"
          render={({ field, fieldState }) => (
            <Field error={fieldState.error?.message} label="Timezone" required>
              <TimezonePicker
                invalid={Boolean(fieldState.error)}
                value={field.value}
                onChange={field.onChange}
              />
            </Field>
          )}
        />
        <FormError message={form.formState.errors.root?.message} />
        <Button
          loading={save.isPending}
          title="Save changes"
          variant="primary"
          onPress={() => void submit()}
        />
      </View>
    </Card>
  );
}

function useAuditLog(workspaceId: string, enabled: boolean) {
  return useInfiniteQuery({
    enabled,
    getNextPageParam: (lastPage: ApiPage<AuditEntry>) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listAuditLogs(workspaceId, pageParam, 25),
    queryKey: ["ws", workspaceId, "audit"],
  });
}

function AuditRow({ entry, last }: { entry: AuditEntry; last: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const resource = auditResourceLabel(entry);
  const hasMetadata = entry.metadata !== null;
  return (
    <Pressable
      accessibilityRole={hasMetadata ? "button" : undefined}
      accessibilityState={hasMetadata ? { expanded } : undefined}
      disabled={!hasMetadata}
      style={({ pressed }) => [styles.auditRow, last && styles.lastRow, pressed && styles.pressed]}
      onPress={() => setExpanded((value) => !value)}
    >
      <View style={styles.auditHeader}>
        <Mono numberOfLines={1} style={styles.auditAction}>
          {entry.action}
        </Mono>
        <Caption>{formatRelative(entry.createdAt)}</Caption>
      </View>
      <Muted numberOfLines={1}>{auditActorName(entry)}</Muted>
      {resource ? <Caption numberOfLines={1}>{resource}</Caption> : null}
      {entry.metadata ? (
        expanded ? (
          <Caption selectable style={styles.metadata}>
            {prettyAuditMetadata(entry.metadata)}
          </Caption>
        ) : (
          <Caption color={colors.accentDark} style={styles.viewJson}>
            View JSON
          </Caption>
        )
      ) : null}
    </Pressable>
  );
}

function AuditLogCard({ audit }: { audit: ReturnType<typeof useAuditLog> }) {
  const rows = audit.data?.pages.flatMap((page) => page.items) ?? [];
  const lastPage = audit.data?.pages[audit.data.pages.length - 1];
  return (
    <Card padding="none" title="Audit log">
      {audit.isPending ? (
        <Spinner label="Loading audit log" />
      ) : audit.isError ? (
        <ErrorState onRetry={() => void audit.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No audit entries yet." />
      ) : (
        <>
          {rows.map((entry, index) => (
            <AuditRow key={entry.id} entry={entry} last={index === rows.length - 1} />
          ))}
          <LoadMore
            loading={audit.isFetchingNextPage}
            nextCursor={audit.hasNextPage ? (lastPage?.nextCursor ?? null) : null}
            onMore={() => void audit.fetchNextPage()}
          />
        </>
      )}
    </Card>
  );
}

function DangerZone() {
  const { user } = useAuth();
  const { can, current } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const [transferOpen, setTransferOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const canTransfer = can("workspace.transfer");
  const canDelete = can("workspace.delete");
  const members = useQuery({
    enabled: canTransfer && transferOpen,
    queryFn: () => listMembers(current.id),
    queryKey: ["ws", current.id, "members"],
  });
  const transfer = useMutation({
    mutationFn: (newOwnerUserId: string) => transferOwnership(current.id, newOwnerUserId),
  });
  const deletion = useMutation({
    mutationFn: (name: string) => deleteWorkspace(current.id, name),
  });

  if (!canTransfer && !canDelete) return null;

  const candidates = transferCandidates(members.data ?? [], user?.id ?? "");
  const candidate = candidates.find((member) => member.userId === selectedUserId);

  const closeTransfer = () => {
    setTransferOpen(false);
    setSelectedUserId(null);
  };

  const confirmTransfer = async () => {
    if (!candidate) return;
    const accepted = await confirm({
      confirmLabel: "Transfer ownership",
      message: "You will become an Admin.",
      title: `Transfer ownership to ${candidate.name}?`,
    });
    if (!accepted) return;
    try {
      await transfer.mutateAsync(candidate.userId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["ws", current.id, "members"] }),
        queryClient.invalidateQueries({ queryKey: ["ws", current.id, "audit"] }),
      ]);
      toast.success(`Ownership transferred to ${candidate.name}`);
      closeTransfer();
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const confirmDeletion = async () => {
    if (!canConfirmDeletion(confirmName, current.name)) return;
    try {
      await deletion.mutateAsync(confirmName.trim());
      await secureStorage.deleteItem(storageKeys.lastWorkspace).catch(() => undefined);
      queryClient.setQueryData<Workspace[]>(["workspaces"], (workspaces) =>
        workspaces?.filter((workspace) => workspace.id !== current.id),
      );
      toast.success("Workspace deleted");
      router.replace("/");
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  return (
    <Card title="Danger zone" tone="danger">
      {canTransfer ? (
        <View style={styles.dangerSection}>
          <Body style={styles.dangerTitle}>Transfer ownership</Body>
          <Muted>{transferOwnershipDescription}</Muted>
          {transferOpen ? (
            <View style={styles.dangerForm}>
              {members.isPending ? (
                <Spinner label="Loading members" />
              ) : members.isError ? (
                <ErrorState onRetry={() => void members.refetch()} />
              ) : candidates.length === 0 ? (
                <EmptyState title="Invite someone first — owners can only transfer to an existing member." />
              ) : (
                <Field label="New owner" required>
                  <SelectSheet
                    options={candidates.map((member) => ({
                      label: `${member.name} — ${member.email}`,
                      value: member.userId,
                    }))}
                    placeholder="Choose a member"
                    title="New owner"
                    value={selectedUserId}
                    onChange={setSelectedUserId}
                  />
                </Field>
              )}
              <View style={styles.actions}>
                <Button title="Cancel" onPress={closeTransfer} />
                <Button
                  disabled={!candidate}
                  loading={transfer.isPending}
                  title="Continue"
                  variant="primary"
                  onPress={() => void confirmTransfer()}
                />
              </View>
            </View>
          ) : (
            <Button
              icon={<Feather color={colors.zinc800} name="repeat" size={16} />}
              style={styles.dangerButton}
              title="Transfer ownership…"
              onPress={() => setTransferOpen(true)}
            />
          )}
        </View>
      ) : null}
      {canTransfer && canDelete ? <Divider style={styles.divider} /> : null}
      {canDelete ? (
        <View style={styles.dangerSection}>
          <Body style={styles.dangerTitle}>Delete workspace</Body>
          <Muted>{deleteWorkspaceDescription}</Muted>
          {deleteOpen ? (
            <View style={styles.dangerForm}>
              <Small>{deleteWorkspaceWarning}</Small>
              <Field hint={`Type “${current.name}” to confirm.`} label="Workspace name" required>
                <Input
                  autoCapitalize="none"
                  autoCorrect={false}
                  invalid={confirmName.length > 0 && !canConfirmDeletion(confirmName, current.name)}
                  placeholder={current.name}
                  returnKeyType="done"
                  value={confirmName}
                  onChangeText={setConfirmName}
                />
              </Field>
              <View style={styles.actions}>
                <Button
                  title="Cancel"
                  onPress={() => {
                    setDeleteOpen(false);
                    setConfirmName("");
                  }}
                />
                <Button
                  disabled={!canConfirmDeletion(confirmName, current.name)}
                  loading={deletion.isPending}
                  title="Delete workspace"
                  variant="danger"
                  onPress={() => void confirmDeletion()}
                />
              </View>
            </View>
          ) : (
            <Button
              icon={<Feather color={colors.white} name="trash-2" size={16} />}
              style={styles.dangerButton}
              title="Delete workspace…"
              variant="danger"
              onPress={() => setDeleteOpen(true)}
            />
          )}
        </View>
      ) : null}
    </Card>
  );
}

export default function SettingsScreen() {
  const { can, current } = useWorkspace();
  const queryClient = useQueryClient();
  const canAudit = can("audit.view");
  const audit = useAuditLog(current.id, canAudit);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    if (canAudit) void audit.refetch();
  };

  return (
    <>
      <Stack.Screen options={{ title: "Workspace Settings" }} />
      <Screen keyboard refreshing={canAudit && audit.isRefetching && !audit.isPending} onRefresh={refresh}>
        <View style={styles.stack}>
          <GeneralCard workspace={current} />
          {canAudit ? <AuditLogCard audit={audit} /> : null}
          <DangerZone />
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  auditAction: { flexShrink: 1, marginRight: spacing.md },
  auditHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  auditRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  dangerButton: { marginTop: spacing.md },
  dangerForm: { gap: spacing.md, marginTop: spacing.md },
  dangerSection: { gap: spacing.xs },
  dangerTitle: { fontWeight: "500" },
  divider: { backgroundColor: "#fecaca", marginVertical: spacing.lg },
  form: { gap: spacing.lg },
  lastRow: { borderBottomWidth: 0 },
  metadata: {
    backgroundColor: colors.zinc950,
    borderRadius: 6,
    color: colors.zinc100,
    fontFamily: "Menlo",
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  pressed: { backgroundColor: colors.zinc50 },
  stack: { gap: spacing.lg },
  viewJson: { fontWeight: "500", marginTop: spacing.xs },
});
