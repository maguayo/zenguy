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
import type { BrowserTest, RunTick } from "@/api/types";
import { StatusBadge, statusPresentation } from "@/components/StatusBadge";
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
  IconTile,
  ListRow,
  PulseStrip,
  Screen,
  Skeleton,
  type ActionMenuItem,
  type FeatherIconName,
  type PulseTick,
} from "@/ui";

/** Leading tile: the last result's tone, a breathing dot while a run is active. */
export function testTile(test: BrowserTest): { icon: FeatherIconName; tone: "accent" | "danger" | "info" | "neutral" | "ok" | "warn" } {
  if (!test.lastRun) return { icon: "globe", tone: "neutral" };
  const tone = statusPresentation(test.lastRun.status).tone;
  const icon: FeatherIconName =
    tone === "ok" ? "check" : tone === "danger" ? "x" : tone === "warn" ? "clock" : tone === "info" ? "play" : "globe";
  return { icon, tone };
}

/** History strip ticks: one per recent run, oldest first; grey slots when there is no data. */
export function runTicks(runs: RunTick[] | undefined): PulseTick[] {
  return (runs ?? []).map((run) => ({ key: run.id, tone: statusPresentation(run.status).tone }));
}

function TestRow({ last, test }: { last: boolean; test: BrowserTest }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
  const run = useRunNow(test);
  const remove = useMutation({ mutationFn: () => deleteTest(current.id, test.id) });
  const base = `/w/${current.id}` as const;
  const tile = testTile(test);

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
      left={<IconTile icon={tile.icon} tone={tile.tone} />}
      meta={`Next run ${formatRelative(test.nextRunAt)}`}
      right={<ActionMenu accessibilityLabel={`Actions for ${test.name}`} items={items} title={test.name} />}
      style={last ? styles.lastRow : undefined}
      subtitle={
        <View style={styles.meta}>
          <Caption numberOfLines={1}>{testSubtitle(test)}</Caption>
          <View style={styles.statusRow}>
            {test.lastRun ? (
              <StatusBadge passedAfterRetry={test.lastRun.passedAfterRetry} status={test.lastRun.status} />
            ) : (
              <Badge>Never run</Badge>
            )}
            {test.lastRun?.finishedAt ? <Caption>{formatRelative(test.lastRun.finishedAt)}</Caption> : null}
            {test.openIncidentId ? <Badge dot pulse tone="danger">Open incident</Badge> : null}
          </View>
          <PulseStrip live={isActiveRun(test)} max={20} size="sm" style={styles.strip} ticks={runTicks(test.recentRuns)} />
        </View>
      }
      title={test.name}
      onPress={() => router.push(`${base}/tests/${test.id}`)}
    />
  );
}

function ListSkeleton() {
  return (
    <Card padding="none">
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={[styles.skeletonRow, index === 3 && styles.lastRow]}>
          <Skeleton height={36} style={styles.skeletonTile} width={36} />
          <View style={styles.skeletonText}>
            <Skeleton width={180} />
            <Skeleton height={12} width={120} />
          </View>
        </View>
      ))}
    </Card>
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
                  <Feather color={colors.onInk} name="plus" size={18} />
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
          <ListSkeleton />
        ) : tests.isError ? (
          <ErrorState onRetry={() => void tests.refetch()} />
        ) : tests.data.length === 0 ? (
          <Card elevated>
            <EmptyState
              action={
                canManage ? (
                  <Button
                    title="Create your first test"
                    variant="accent"
                    onPress={() => router.push(`${base}/tests/new`)}
                  />
                ) : undefined
              }
              description="Describe a flow in plain language and Zenguy will verify it in a real browser on a schedule."
              icon={<IconTile icon="globe" size={44} tone="accent" />}
              title="No browser tests yet"
            />
          </Card>
        ) : (
          <Card eyebrow={`${tests.data.length} ${tests.data.length === 1 ? "test" : "tests"}`} padding="none">
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
  headerActions: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  headerButton: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radius.full,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  lastRow: { borderBottomWidth: 0 },
  meta: { gap: spacing.xs + 1, marginTop: 2 },
  pressed: { opacity: 0.7 },
  skeletonRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
  },
  skeletonText: { flex: 1, gap: spacing.sm },
  skeletonTile: { borderRadius: radius.md },
  statusRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  strip: { marginTop: 2, maxWidth: 220 },
});
