import { Feather } from "@expo/vector-icons";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { listChannels } from "@/api/channels";
import { deleteTest, getTest, listRuns } from "@/api/tests";
import type { RunListItem } from "@/api/types";
import { CopyButton } from "@/components/CopyButton";
import { RunSourceBadge } from "@/components/RunSourceBadge";
import { StatusBadge } from "@/components/StatusBadge";
import {
  attemptsLabel,
  deviceDescription,
  deviceLabel,
  retriesLabel,
} from "@/components/tests/labels";
import { parseRunFilter, runFilterItems, type RunFilter } from "@/components/tests/test-detail";
import { useRunNow } from "@/components/tests/useRunNow";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import type { ApiPage } from "@/lib/api";
import { apiErrorMessage, itemQueryErrorMessage } from "@/lib/errors";
import { formatDateTime, formatDuration, formatInterval, formatRelative } from "@/lib/format";
import { firstParam } from "@/lib/links";
import { colors, spacing } from "@/theme";
import {
  ActionMenu,
  Badge,
  Body,
  Caption,
  Card,
  confirm,
  DescriptionList,
  EmptyState,
  ErrorState,
  Label,
  ListRow,
  LoadMore,
  Screen,
  SegmentedTabs,
  Spinner,
} from "@/ui";

function SummaryCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <Card style={styles.gridCard} title={title}>
      {children}
    </Card>
  );
}

export default function TestDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; testId: string }>();
  const testId = firstParam(params.testId) ?? "";
  const { can, current, timezone } = useWorkspace();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<RunFilter>(() => parseRunFilter(firstParam(params.status)));
  const [instructionsExpanded, setInstructionsExpanded] = useState(false);
  const status = filter === "ALL" ? null : filter;
  const base = `/w/${current.id}` as const;
  const test = useQuery({
    queryFn: () => getTest(current.id, testId),
    queryKey: ["ws", current.id, "tests", testId],
  });
  const channels = useQuery({
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
  });
  const runs = useInfiniteQuery({
    enabled: test.isSuccess,
    getNextPageParam: (lastPage: ApiPage<RunListItem>) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listRuns(current.id, testId, { cursor: pageParam, status }),
    queryKey: ["ws", current.id, "tests", testId, "runs", { status }],
  });
  const remove = useMutation({ mutationFn: () => deleteTest(current.id, testId) });
  const name = test.data?.name ?? "Browser test";
  const run = useRunNow({ id: testId, name });

  const deleteCurrentTest = async () => {
    const confirmed = await confirm({
      confirmLabel: "Delete",
      destructive: true,
      message: "Its history stays available for 30 days.",
      title: `Delete "${name}"?`,
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success("Test deleted");
      router.replace(`${base}/tests`);
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const refresh = () => {
    void test.refetch();
    if (test.isSuccess) void runs.refetch();
  };

  const testData = test.data;
  const channelNames = new Map((channels.data ?? []).map((channel) => [channel.id, channel.name]));
  const rows = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const lastRun = testData?.lastRun ?? null;
  const openIncidentId = testData?.openIncidentId ?? null;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              {can("tests.run") ? (
                <Pressable
                  accessibilityLabel="Run now"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: run.pending }}
                  disabled={run.pending}
                  hitSlop={8}
                  style={({ pressed }) => [styles.runNow, (pressed || run.pending) && styles.dim]}
                  onPress={run.requestRun}
                >
                  <Feather color={colors.accent} name="play" size={16} />
                  <Label color={colors.accent}>Run now</Label>
                </Pressable>
              ) : null}
              {can("tests.manage") ? (
                <ActionMenu
                  accessibilityLabel={`More actions for ${name}`}
                  items={[
                    { label: "Edit", onSelect: () => router.push(`${base}/tests/${testId}/edit`) },
                    { destructive: true, label: "Delete", onSelect: () => void deleteCurrentTest() },
                  ]}
                />
              ) : null}
            </View>
          ),
          title: name,
        }}
      />
      <Screen refreshing={test.isRefetching && !test.isPending} onRefresh={refresh}>
        {test.isPending || channels.isPending ? (
          <Spinner label="Loading browser test" />
        ) : test.isError ? (
          <ErrorState message={itemQueryErrorMessage(test.error)} onRetry={() => void test.refetch()} />
        ) : channels.isError ? (
          <ErrorState onRetry={() => void channels.refetch()} />
        ) : testData ? (
          <View style={styles.stack}>
            {openIncidentId ? (
              <Card tone="danger">
                <View style={styles.incidentRow}>
                  <Label color={colors.dangerDark} style={styles.incidentText}>
                    This test has an open incident.
                  </Label>
                  <Pressable
                    accessibilityRole="link"
                    hitSlop={8}
                    onPress={() => router.push(`${base}/incidents/${openIncidentId}`)}
                  >
                    <Label color={colors.dangerDark}>View incident →</Label>
                  </Pressable>
                </View>
              </Card>
            ) : null}

            <View style={styles.grid}>
              <SummaryCard title="Last result">
                {lastRun ? (
                  <View style={styles.lastResult}>
                    <StatusBadge passedAfterRetry={lastRun.passedAfterRetry} status={lastRun.status} />
                    <Caption>
                      {lastRun.finishedAt ? formatRelative(lastRun.finishedAt) : "In progress"} ·{" "}
                      {formatDuration(lastRun.durationMs)}
                    </Caption>
                  </View>
                ) : (
                  <Body color={colors.zinc700}>Never run</Body>
                )}
              </SummaryCard>
              <SummaryCard title="Next run">
                <Body style={styles.strong}>{formatRelative(testData.nextRunAt)}</Body>
              </SummaryCard>
              <SummaryCard title="Schedule">
                <Body style={styles.strong}>{formatInterval(testData.intervalHours)}</Body>
                <Caption>{deviceLabel(testData.device)}</Caption>
              </SummaryCard>
              <SummaryCard title="Retries">
                <Body style={styles.strong}>{retriesLabel(testData.maxRetries)}</Body>
              </SummaryCard>
            </View>

            <Card title="Configuration">
              <DescriptionList
                items={[
                  {
                    label: "Starting URL",
                    value: (
                      <View style={styles.inline}>
                        <Body numberOfLines={1} selectable style={styles.inlineText}>
                          {testData.startUrl}
                        </Body>
                        <CopyButton label="Copy starting URL" text={testData.startUrl} />
                      </View>
                    ),
                  },
                  { label: "Device", value: deviceDescription(testData.device) },
                  {
                    label: "Instructions",
                    value: (
                      <View>
                        <Body numberOfLines={instructionsExpanded ? undefined : 6} selectable>
                          {testData.instructions}
                        </Body>
                        <Pressable
                          accessibilityRole="button"
                          hitSlop={8}
                          style={styles.toggle}
                          onPress={() => setInstructionsExpanded((value) => !value)}
                        >
                          <Label color={colors.accentDark}>
                            {instructionsExpanded ? "Show less" : "Show more"}
                          </Label>
                        </Pressable>
                      </View>
                    ),
                  },
                  {
                    label: "Notification channels",
                    value:
                      testData.channelIds.length === 0 ? (
                        "None"
                      ) : (
                        <View style={styles.badges}>
                          {testData.channelIds.map((channelId) => (
                            <Badge key={channelId}>{channelNames.get(channelId) ?? "Unknown channel"}</Badge>
                          ))}
                        </View>
                      ),
                  },
                  { label: "Notify on recovery", value: testData.notifyOnRecovery ? "Yes" : "No" },
                ]}
              />
            </Card>

            <Card padding="none" title="Runs">
              <View style={styles.tabs}>
                <SegmentedTabs items={runFilterItems} value={filter} onChange={setFilter} />
              </View>
              {runs.isError ? (
                <ErrorState onRetry={() => void runs.refetch()} />
              ) : runs.isPending ? (
                <Spinner label="Loading runs" />
              ) : rows.length === 0 ? (
                <EmptyState description="Run it now or wait for the schedule." title="No runs yet" />
              ) : (
                <>
                  {rows.map((item, index) => (
                    <ListRow
                      key={item.id}
                      style={index === rows.length - 1 ? styles.lastRow : undefined}
                      subtitle={
                        <View style={styles.runMeta}>
                          <View style={styles.badges}>
                            <RunSourceBadge source={item.source} />
                            <StatusBadge passedAfterRetry={item.passedAfterRetry} status={item.status} />
                          </View>
                          <Caption>
                            {formatDuration(item.durationMs)} · Attempts{" "}
                            {attemptsLabel(item.attemptCount, testData.maxRetries)}
                            {item.triggeredBy ? ` · ${item.triggeredBy.name}` : ""}
                            {item.billable ? " · 1 run" : ""}
                          </Caption>
                        </View>
                      }
                      title={formatDateTime(item.createdAt, timezone)}
                      onPress={() => router.push(`${base}/runs/${item.id}`)}
                    />
                  ))}
                  <LoadMore
                    loading={runs.isFetchingNextPage}
                    nextCursor={
                      runs.hasNextPage
                        ? (runs.data.pages[runs.data.pages.length - 1]?.nextCursor ?? null)
                        : null
                    }
                    onMore={() => void runs.fetchNextPage()}
                  />
                </>
              )}
            </Card>
          </View>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dim: { opacity: 0.55 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  gridCard: { flexBasis: "47%", flexGrow: 1 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  incidentRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "space-between" },
  incidentText: { flexShrink: 1 },
  inline: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  inlineText: { flexShrink: 1 },
  lastResult: { gap: spacing.sm },
  lastRow: { borderBottomWidth: 0 },
  runMeta: { gap: spacing.xs, marginTop: 2 },
  runNow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  stack: { gap: spacing.lg },
  strong: { fontWeight: "500" },
  tabs: { paddingBottom: spacing.md, paddingHorizontal: spacing.lg },
  toggle: { alignSelf: "flex-start", marginTop: spacing.xs },
});
