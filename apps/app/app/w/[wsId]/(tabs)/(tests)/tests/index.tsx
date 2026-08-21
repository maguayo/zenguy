import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import {
  deleteTest,
  exportTests,
  importTests,
  listTests,
  type ExportFormat,
} from "@/api/tests";
import type { BrowserTest } from "@/api/types";
import { StatusBadge } from "@/components/StatusBadge";
import { testSubtitle } from "@/components/tests/labels";
import {
  importDocumentTypes,
  importErrorMessage,
  importSummaryMessage,
} from "@/components/tests/tests-list";
import { isActiveRun, useRunNow } from "@/components/tests/useRunNow";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { apiErrorMessage } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { shareTextFile } from "@/lib/share";
import { largeTitleOptions } from "@/lib/stack-options";
import { colors, spacing } from "@/theme";
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
  Muted,
  Screen,
  Spinner,
  type ActionMenuItem,
} from "@/ui";

function TestRow({ last, test }: { last: boolean; test: BrowserTest }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
  const run = useRunNow(test);
  const remove = useMutation({ mutationFn: () => deleteTest(current.id, test.id) });
  const base = `/w/${current.id}` as const;

  const removeTest = async () => {
    const confirmed = await confirm({
      confirmLabel: "Delete",
      destructive: true,
      message: "Its history stays available for 30 days.",
      title: `Delete "${test.name}"?`,
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success("Test deleted");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const items: ActionMenuItem[] = [
    { label: "Open", onSelect: () => router.push(`${base}/tests/${test.id}`) },
    ...(can("tests.run")
      ? [
          {
            disabled: isActiveRun(test) || run.pending,
            label: "Run now",
            onSelect: run.requestRun,
          },
        ]
      : []),
    ...(can("tests.manage")
      ? [
          { label: "Edit", onSelect: () => router.push(`${base}/tests/${test.id}/edit`) },
          { destructive: true, label: "Delete", onSelect: () => void removeTest() },
        ]
      : []),
  ];

  return (
    <ListRow
      chevron={false}
      right={<ActionMenu accessibilityLabel={`Actions for ${test.name}`} items={items} title={test.name} />}
      style={last ? styles.lastRow : undefined}
      subtitle={
        <View style={styles.meta}>
          <Muted>{testSubtitle(test)}</Muted>
          <View style={styles.statusRow}>
            {test.lastRun ? (
              <StatusBadge passedAfterRetry={test.lastRun.passedAfterRetry} status={test.lastRun.status} />
            ) : (
              <Caption>Never run</Caption>
            )}
            {test.lastRun?.finishedAt ? <Caption>{formatRelative(test.lastRun.finishedAt)}</Caption> : null}
            {test.openIncidentId ? <Badge tone="danger">Open incident</Badge> : null}
          </View>
          <Caption>Next run {formatRelative(test.nextRunAt)}</Caption>
        </View>
      }
      title={test.name}
      onPress={() => router.push(`${base}/tests/${test.id}`)}
    />
  );
}

export default function TestsListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
  const base = `/w/${current.id}` as const;
  const tests = useQuery({
    queryFn: () => listTests(current.id),
    queryKey: ["ws", current.id, "tests"],
  });
  const importFile = useMutation({
    mutationFn: (text: string) => importTests(current.id, text),
  });
  const canManage = can("tests.manage");
  const hasTests = (tests.data?.length ?? 0) > 0;

  const runImport = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: importDocumentTypes,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset) return;
      const text = await new File(asset.uri).text();
      const summary = await importFile.mutateAsync(text);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success(importSummaryMessage(summary));
    } catch (error) {
      if (!handleMutationError(error)) toast.error(importErrorMessage(error));
    }
  };

  const runExport = async (format: ExportFormat) => {
    try {
      const { filename, mimeType, text } = await exportTests(current.id, format);
      await shareTextFile(filename, text, mimeType);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const menuItems: ActionMenuItem[] = [
    ...(hasTests
      ? [
          { label: "Export as YAML", onSelect: () => void runExport("yaml") },
          { label: "Export as JSON", onSelect: () => void runExport("json") },
        ]
      : []),
    ...(canManage
      ? [{ disabled: importFile.isPending, label: "Import…", onSelect: () => void runImport() }]
      : []),
  ];

  return (
    <>
      <Stack.Screen
        options={{
          ...largeTitleOptions,
          headerRight: () => (
            <View style={styles.headerActions}>
              {menuItems.length > 0 ? <ActionMenu items={menuItems} /> : null}
              {canManage ? (
                <Pressable
                  accessibilityLabel="New test"
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                  onPress={() => router.push(`${base}/tests/new`)}
                >
                  <Feather color={colors.accent} name="plus" size={24} />
                </Pressable>
              ) : null}
            </View>
          ),
          title: "Browser Tests",
        }}
      />
      <Screen
        refreshing={tests.isRefetching && !tests.isPending}
        onRefresh={() => void tests.refetch()}
      >
        {tests.isPending ? (
          <Spinner label="Loading browser tests" />
        ) : tests.isError ? (
          <ErrorState onRetry={() => void tests.refetch()} />
        ) : tests.data.length === 0 ? (
          <Card>
            <EmptyState
              action={
                canManage ? (
                  <Button
                    title="Create your first test"
                    variant="primary"
                    onPress={() => router.push(`${base}/tests/new`)}
                  />
                ) : undefined
              }
              description="Describe a flow in plain language and Zenguy will verify it in a real browser on a schedule."
              icon={<Feather color={colors.zinc400} name="globe" size={24} />}
              title="No browser tests yet"
            />
          </Card>
        ) : (
          <Card padding="none">
            {tests.data.map((test, index) => (
              <TestRow key={test.id} last={index === tests.data.length - 1} test={test} />
            ))}
          </Card>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  headerActions: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  headerButton: { alignItems: "center", borderRadius: 8, height: 36, justifyContent: "center", width: 36 },
  lastRow: { borderBottomWidth: 0 },
  meta: { gap: spacing.xs, marginTop: 2 },
  pressed: { backgroundColor: colors.zinc100 },
  statusRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
