import { Feather } from "@expo/vector-icons";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
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
import { isTerminalRun } from "@/components/tests/run-status";
import { statusIcon, statusTone } from "@/components/tests/status-icon";
import { parseRunFilter, runFilterItems, type RunFilter } from "@/components/tests/test-detail";
import { useRunNow } from "@/components/tests/useRunNow";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import type { ApiPage } from "@/lib/api";
import { apiErrorMessage, itemQueryErrorMessage } from "@/lib/errors";
import { formatDateTime, formatDuration, formatInterval, formatRelative } from "@/lib/format";
import { firstParam } from "@/lib/links";
import { colors, radius, spacing } from "@/theme";
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
  Eyebrow,
  IconTile,
  Label,
  ListRow,
  LoadMore,
  Mono,
  MonoSmall,
  PulseStrip,
  Screen,
  SegmentedTabs,
  Spinner,
  type PulseTick,
} from "@/ui";

/** Oldest first, so the strip reads left-to-right like a timeline. */
export function runTicks(runs: RunListItem[]): PulseTick[] {
  return [...runs]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((run) => ({ key: run.id, tone: statusTone(run.status) }));
}

function Fact({ hint, label, value }: { hint?: string; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Eyebrow numberOfLines={1}>{label}</Eyebrow>
      <Label numberOfLines={1} style={styles.factValue}>
        {value}
      </Label>
      {hint ? <Caption numberOfLines={1}>{hint}</Caption> : null}
    </View>
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
  // Unfiltered, so the strip keeps its history while the list is filtered.
  const recentRuns = useQuery({
    enabled: test.isSuccess,
    queryFn: () => listRuns(current.id, testId, { cursor: null, status: null }),
    queryKey: ["ws", current.id, "tests", testId, "runs", "recent"],
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
    if (test.isSuccess) {
      void runs.refetch();
      void recentRuns.refetch();
    }
  };

  const testData = test.data;
  const channelNames = new Map((channels.data ?? []).map((channel) => [channel.id, channel.name]));
  const rows = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const lastRun = testData?.lastRun ?? null;
  const openIncidentId = testData?.openIncidentId ?? null;
  const live = lastRun !== null && !isTerminalRun(lastRun.status);
  const ticks = runTicks(recentRuns.data?.items ?? []);

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
                  <Feather color={colors.onInk} name="play" size={13} />
                  <Label color={colors.onInk}>Run now</Label>
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
                  <View style={styles.incidentLead}>
                    <Badge dot pulse tone="danger">
                      Open incident
                    </Badge>
                    <Label color={colors.dangerDark} style={styles.incidentText}>
                      This test has an open incident.
                    </Label>
                  </View>
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

            <Card elevated>
              <View style={styles.summaryTop}>
                <IconTile
                  icon={lastRun ? statusIcon(lastRun.status) : "globe"}
                  size={44}
                  tone={lastRun ? statusTone(lastRun.status) : "neutral"}
                />
                <View style={styles.summaryText}>
                  <Eyebrow>Last result</Eyebrow>
                  <View style={styles.summaryStatus}>
                    {lastRun ? (
                      <StatusBadge passedAfterRetry={lastRun.passedAfterRetry} status={lastRun.status} />
                    ) : (
                      <Badge>Never run</Badge>
                    )}
                  </View>
                  <MonoSmall numberOfLines={1}>
                    {lastRun
                      ? `${lastRun.finishedAt ? formatRelative(lastRun.finishedAt) : "In progress"} · ${formatDuration(lastRun.durationMs)}`
                      : "Run it now or wait for the schedule"}
                  </MonoSmall>
                </View>
              </View>
              <PulseStrip live={live} style={styles.strip} ticks={ticks} />
              <MonoSmall style={styles.stripLabel}>
                {ticks.length === 0 ? "No runs yet" : `Last ${ticks.length} ${ticks.length === 1 ? "run" : "runs"}`}
              </MonoSmall>
              <View style={styles.facts}>
                <Fact label="Next run" value={formatRelative(testData.nextRunAt)} />
                <Fact hint={deviceLabel(testData.device)} label="Schedule" value={formatInterval(testData.intervalHours)} />
                <Fact label="Retries" value={retriesLabel(testData.maxRetries)} />
              </View>
            </Card>

            <Card title="Configuration">
              <DescriptionList
                items={[
                  {
                    label: "Starting URL",
                    value: (
                      <View style={styles.inline}>
                        <Mono numberOfLines={1} selectable style={styles.inlineText}>
                          {testData.startUrl}
                        </Mono>
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
                    label: "Channels",
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
                  { label: "On recovery", value: testData.notifyOnRecovery ? "Notify" : "Stay quiet" },
                ]}
              />
            </Card>

            <Card eyebrow="Runs" padding="none">
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
                      left={<IconTile icon={statusIcon(item.status)} tone={statusTone(item.status)} />}
                      meta={[
                        formatDuration(item.durationMs),
                        `Attempts ${attemptsLabel(item.attemptCount, testData.maxRetries)}`,
                        item.triggeredBy?.name,
                        item.billable ? "1 run" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      style={index === rows.length - 1 ? styles.lastRow : undefined}
                      subtitle={
                        <View style={styles.badges}>
                          <StatusBadge passedAfterRetry={item.passedAfterRetry} status={item.status} />
                          <RunSourceBadge source={item.source} />
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
  badges: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  dim: { opacity: 0.55 },
  fact: { flex: 1, gap: 3, minWidth: 0 },
  factValue: { color: colors.text },
  facts: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerActions: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  incidentLead: { alignItems: "center", flexDirection: "row", flexShrink: 1, flexWrap: "wrap", gap: spacing.sm },
  incidentRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  incidentText: { flexShrink: 1 },
  inline: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  inlineText: { flexShrink: 1 },
  lastRow: { borderBottomWidth: 0 },
  runNow: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radius.full,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stack: { gap: spacing.xl },
  strip: { marginTop: spacing.lg },
  stripLabel: { marginTop: spacing.sm },
  summaryStatus: { flexDirection: "row", marginTop: spacing.xs },
  summaryText: { flex: 1, gap: 3, minWidth: 0 },
  summaryTop: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  tabs: { paddingBottom: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  toggle: { alignSelf: "flex-start", marginTop: spacing.xs },
});
