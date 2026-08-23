import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { downloadReport, getRun } from "@/api/tests";
import type { AttemptSummary } from "@/api/types";
import { CopyButton } from "@/components/CopyButton";
import { RunSourceBadge } from "@/components/RunSourceBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { AttemptDetail } from "@/components/tests/AttemptDetail";
import { deviceLabel, runnerLabel } from "@/components/tests/labels";
import {
  defaultExpandedAttemptId,
  draftValidationNote,
  executedBy,
  expiredRunMessage,
  isMissingRun,
  reportNote,
} from "@/components/tests/run-detail";
import { RunStatusPanel } from "@/components/tests/RunStatusPanel";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { formatDateTime, formatDuration } from "@/lib/format";
import { firstParam } from "@/lib/links";
import { shareTextFile } from "@/lib/share";
import { colors, spacing } from "@/theme";
import {
  Body,
  Caption,
  Card,
  DescriptionList,
  EmptyState,
  ErrorState,
  Heading,
  Label,
  Mono,
  Screen,
  Small,
  Spinner,
} from "@/ui";

function AttemptCard({
  attempt,
  expanded,
  onToggle,
  timezone,
  wsId,
}: {
  attempt: AttemptSummary;
  expanded: boolean;
  onToggle: () => void;
  timezone: string;
  wsId: string;
}) {
  return (
    <Card padding="none">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [styles.attemptHeader, pressed && styles.pressed]}
        onPress={onToggle}
      >
        <Body style={styles.attemptTitle}>Attempt {attempt.attemptIndex + 1}</Body>
        <StatusBadge status={attempt.status} />
        <Caption style={styles.attemptMeta}>
          {formatDuration(attempt.durationMs)}
          {attempt.retryDelaySeconds > 0 ? ` · waited ${attempt.retryDelaySeconds} s` : ""}
          {attempt.runnerKind ? ` · ${runnerLabel(attempt.runnerKind)}` : ""}
        </Caption>
        <Feather color={colors.zinc500} name={expanded ? "chevron-up" : "chevron-down"} size={18} />
      </Pressable>
      {expanded ? (
        <View style={styles.attemptBody}>
          <AttemptDetail attemptId={attempt.id} timezone={timezone} wsId={wsId} />
        </View>
      ) : null}
    </Card>
  );
}

export default function RunDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ runId: string }>();
  const runId = firstParam(params.runId) ?? "";
  const { can, current, timezone } = useWorkspace();
  const toast = useToast();
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const appliedDefault = useRef(false);
  const base = `/w/${current.id}` as const;
  // Shares its cache entry with RunStatusPanel, which polls while the run is live.
  const run = useQuery({
    queryFn: () => getRun(current.id, runId),
    queryKey: ["ws", current.id, "runs", runId],
  });
  const attempts = run.data?.attempts;

  useEffect(() => {
    if (appliedDefault.current || !attempts || attempts.length === 0) return;
    appliedDefault.current = true;
    setExpandedAttemptId(defaultExpandedAttemptId(attempts));
  }, [attempts]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await run.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const saveReport = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const report = await downloadReport(current.id, runId);
      await shareTextFile(report.filename, report.text, report.mimeType);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) toast.error("Report not available.");
      else toast.error(apiErrorMessage(error));
    } finally {
      setDownloading(false);
    }
  };

  const data = run.data;
  const hasReport =
    data !== undefined && (data.status === "FAILED" || data.status === "TIMEOUT") && can("reports.download");
  const testId = data?.testId ?? null;
  const incidentId = data?.incidentId ?? null;
  const executor = data ? executedBy(data.attempts) : null;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: hasReport
            ? () => (
                <Pressable
                  accessibilityHint={reportNote}
                  accessibilityLabel="Download report"
                  accessibilityRole="button"
                  accessibilityState={{ busy: downloading }}
                  disabled={downloading}
                  hitSlop={8}
                  style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                  onPress={() => void saveReport()}
                >
                  {downloading ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <Feather color={colors.accent} name="download" size={22} />
                  )}
                </Pressable>
              )
            : undefined,
          title: "Run",
        }}
      />
      <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
        {run.isPending ? (
          <Spinner label="Loading run" />
        ) : run.isError ? (
          <ErrorState
            message={isMissingRun(run.error) ? expiredRunMessage : undefined}
            onRetry={() => void run.refetch()}
          />
        ) : data ? (
          <View style={styles.stack}>
            <View style={styles.crumbs}>
              <Pressable accessibilityRole="link" hitSlop={6} onPress={() => router.push(`${base}/tests`)}>
                <Caption color={colors.accentDark}>Browser Tests</Caption>
              </Pressable>
              <Caption>/</Caption>
              {testId ? (
                <Pressable
                  accessibilityRole="link"
                  hitSlop={6}
                  style={styles.crumbLink}
                  onPress={() => router.push(`${base}/tests/${testId}`)}
                >
                  <Caption color={colors.accentDark} numberOfLines={1}>
                    {data.snapshot.name}
                  </Caption>
                </Pressable>
              ) : (
                <Caption>Draft validation</Caption>
              )}
              <Caption>/</Caption>
              <Caption color={colors.zinc700}>Run</Caption>
            </View>

            {data.testId === null ? (
              <Card tone="info">
                <View style={styles.noteRow}>
                  <Feather color={colors.info} name="info" size={16} style={styles.noteIcon} />
                  <Small color={colors.zinc700} style={styles.noteText}>
                    {draftValidationNote}
                  </Small>
                </View>
              </Card>
            ) : null}

            {hasReport ? <Caption>{reportNote}</Caption> : null}

            <Card title="Progress">
              <RunStatusPanel runId={runId} wsId={current.id} />
            </Card>

            <Card title="Run details">
              <DescriptionList
                items={[
                  {
                    label: "Run ID",
                    value: (
                      <View style={styles.inline}>
                        <Mono selectable style={styles.inlineText}>
                          {data.id}
                        </Mono>
                        <CopyButton label="Copy run ID" text={data.id} />
                      </View>
                    ),
                  },
                  { label: "Source", value: <RunSourceBadge source={data.source} /> },
                  {
                    label: "Device",
                    value: `${deviceLabel(data.snapshot.device)} · ${data.snapshot.viewport.width} × ${data.snapshot.viewport.height}`,
                  },
                  { label: "Started", value: data.startedAt ? formatDateTime(data.startedAt, timezone) : "—" },
                  { label: "Finished", value: data.finishedAt ? formatDateTime(data.finishedAt, timezone) : "—" },
                  { label: "Total duration", value: formatDuration(data.durationMs) },
                  { label: "Attempts", value: data.attemptCount },
                  { label: "Billable", value: data.billable ? "1 run" : "Not billed" },
                  { label: "Triggered by", value: data.triggeredBy?.name ?? "—" },
                  {
                    label: "Incident",
                    value: incidentId ? (
                      <Pressable
                        accessibilityRole="link"
                        hitSlop={8}
                        style={styles.link}
                        onPress={() => router.push(`${base}/incidents/${incidentId}`)}
                      >
                        <Label color={colors.accentDark}>View incident</Label>
                      </Pressable>
                    ) : (
                      "—"
                    ),
                  },
                  // The executor that actually ran the test, not the one planned at creation.
                  { label: "Model", value: executor?.modelName ?? data.snapshot.modelName },
                  {
                    label: "Runner",
                    value: executor ? (
                      <View>
                        <Body>{runnerLabel(executor.runnerKind)}</Body>
                        {executor.runnerVersion ? (
                          <Caption selectable>{executor.runnerVersion}</Caption>
                        ) : null}
                      </View>
                    ) : (
                      "—"
                    ),
                  },
                ]}
              />
            </Card>

            <Card title="Instructions used">
              <Body color={colors.zinc700} selectable>
                {data.snapshot.instructions}
              </Body>
              <View style={styles.startUrl}>
                <Caption>
                  Starting URL:{" "}
                  <Mono color={colors.textMuted} selectable style={styles.startUrlText}>
                    {data.snapshot.startUrl}
                  </Mono>
                </Caption>
              </View>
            </Card>

            <View style={styles.attempts}>
              <Heading style={styles.sectionTitle}>Attempts</Heading>
              {data.attempts.length === 0 ? (
                <Card>
                  <EmptyState
                    description="The first attempt will appear when the browser starts."
                    title="No attempts yet"
                  />
                </Card>
              ) : (
                data.attempts.map((attempt) => (
                  <AttemptCard
                    key={attempt.id}
                    attempt={attempt}
                    expanded={expandedAttemptId === attempt.id}
                    timezone={timezone}
                    wsId={current.id}
                    onToggle={() =>
                      setExpandedAttemptId((currentId) => (currentId === attempt.id ? null : attempt.id))
                    }
                  />
                ))
              )}
            </View>
          </View>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  attemptBody: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  attemptHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  attemptMeta: { marginLeft: "auto" },
  attemptTitle: { fontWeight: "500" },
  attempts: { gap: spacing.md },
  crumbLink: { flexShrink: 1 },
  crumbs: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  headerButton: { alignItems: "center", borderRadius: 8, height: 36, justifyContent: "center", width: 36 },
  inline: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  inlineText: { flexShrink: 1 },
  link: { alignSelf: "flex-start" },
  noteIcon: { marginTop: 1 },
  noteRow: { flexDirection: "row", gap: spacing.sm },
  noteText: { flex: 1 },
  pressed: { backgroundColor: colors.zinc100 },
  sectionTitle: { fontSize: 15 },
  stack: { gap: spacing.lg },
  startUrl: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.lg, paddingTop: spacing.md },
  startUrlText: { fontSize: 12, lineHeight: 16 },
});
