import { useState } from "react";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { deleteSecret, listSecrets } from "@/api/secrets";
import type { Secret } from "@/api/types";
import { SecretForm } from "@/components/secrets/SecretForm";
import {
  deleteSecretTitle,
  deleteSecretWarning,
  secretsIntro,
  secretsWriteOnlyNote,
  stagingCredentialsWarning,
  type SecretFormMode,
} from "@/components/secrets/secret-form";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { apiErrorMessage } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";
import {
  ActionMenu,
  Badge,
  Button,
  Caption,
  Card,
  confirm,
  EmptyState,
  ErrorState,
  ListRow,
  Mono,
  Muted,
  Screen,
  Small,
  Spinner,
} from "@/ui";

interface SecretEditor {
  mode: SecretFormMode;
  secret?: Secret;
}

function HeaderAddButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Add secret"
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
      onPress={onPress}
    >
      <Feather color={colors.accent} name="plus" size={24} />
    </Pressable>
  );
}

export default function SecretsScreen() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
  const manage = can("secrets.manage");
  // The editor keeps its target while the sheet animates out; only `open` toggles.
  const [editor, setEditor] = useState<SecretEditor>({ mode: "create" });
  const [editorOpen, setEditorOpen] = useState(false);
  const secrets = useQuery({
    queryFn: () => listSecrets(current.id),
    queryKey: ["ws", current.id, "secrets"],
  });
  const remove = useMutation({
    mutationFn: (secret: Secret) => deleteSecret(current.id, secret.id),
  });

  const openEditor = (mode: SecretFormMode, secret?: Secret) => {
    setEditor({ mode, secret });
    setEditorOpen(true);
  };

  const removeSecret = async (secret: Secret) => {
    const confirmed = await confirm({
      confirmLabel: "Delete",
      destructive: true,
      message: deleteSecretWarning,
      title: deleteSecretTitle(secret),
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync(secret);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "secrets"] });
      toast.success("Secret deleted");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const addButton = manage ? (
    <Button
      icon={<Feather color={colors.white} name="plus" size={16} />}
      title="Add secret"
      variant="primary"
      onPress={() => openEditor("create")}
    />
  ) : undefined;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: manage ? () => <HeaderAddButton onPress={() => openEditor("create")} /> : undefined,
          title: "Secrets",
        }}
      />
      <Screen
        refreshing={secrets.isRefetching && !secrets.isPending}
        onRefresh={() => void secrets.refetch()}
      >
        <View style={styles.stack}>
          <Card tone="warn">
            <View accessibilityRole="text" style={styles.warning}>
              <Feather color={colors.warn} name="alert-triangle" size={18} style={styles.warningIcon} />
              <Small color={colors.warn} style={styles.warningText}>
                {stagingCredentialsWarning}
              </Small>
            </View>
          </Card>
          <Muted>
            {secretsIntro} {secretsWriteOnlyNote}
          </Muted>

          {secrets.isPending ? (
            <Spinner label="Loading secrets" />
          ) : secrets.isError ? (
            <ErrorState onRetry={() => void secrets.refetch()} />
          ) : (
            <Card padding="none">
              {secrets.data.length === 0 ? (
                <EmptyState
                  action={addButton}
                  description={secretsIntro}
                  icon={<Feather color={colors.zinc400} name="key" size={24} />}
                  title="No secrets yet"
                />
              ) : (
                secrets.data.map((secret, index) => (
                  <ListRow
                    key={secret.id}
                    right={
                      manage ? (
                        <ActionMenu
                          accessibilityLabel={`Actions for ${secret.key}`}
                          items={[
                            { label: "Replace value…", onSelect: () => openEditor("replace", secret) },
                            { label: "Edit domains…", onSelect: () => openEditor("meta", secret) },
                            { destructive: true, label: "Delete", onSelect: () => void removeSecret(secret) },
                          ]}
                          title={`{{${secret.key}}}`}
                        />
                      ) : undefined
                    }
                    style={index === secrets.data.length - 1 && styles.lastRow}
                    subtitle={
                      <View style={styles.meta}>
                        {secret.description ? <Muted numberOfLines={2}>{secret.description}</Muted> : null}
                        <View style={styles.domains}>
                          {secret.allowedDomains.map((domain) => (
                            <Badge key={domain}>{domain}</Badge>
                          ))}
                        </View>
                        <Caption>
                          Created by {secret.createdBy?.name ?? "System"} · Updated{" "}
                          {formatRelative(secret.updatedAt)}
                        </Caption>
                      </View>
                    }
                    title={
                      <View style={styles.keyRow}>
                        <Feather color={colors.zinc500} name="key" size={14} />
                        <Mono selectable style={styles.key}>{`{{${secret.key}}}`}</Mono>
                      </View>
                    }
                  />
                ))
              )}
            </Card>
          )}
        </View>
      </Screen>

      <SecretForm
        key={`${editor.mode}:${editor.secret?.id ?? "new"}`}
        mode={editor.mode}
        open={editorOpen}
        secret={editor.secret}
        onClose={() => setEditorOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  domains: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  headerButton: { alignItems: "center", borderRadius: radius.md, height: 36, justifyContent: "center", width: 36 },
  headerButtonPressed: { backgroundColor: colors.zinc100 },
  key: { flexShrink: 1, fontWeight: "500" },
  keyRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  lastRow: { borderBottomWidth: 0 },
  meta: { gap: spacing.xs + 2 },
  stack: { gap: spacing.lg },
  warning: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md },
  warningIcon: { marginTop: 1 },
  warningText: { flex: 1, fontWeight: "500" },
});
