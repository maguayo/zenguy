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
import { statusIcon, statusTone } from "@/components/tests/status-icon";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { formatDateTime, formatDuration } from "@/lib/format";
import { firstParam } from "@/lib/links";
import { shareTextFile } from "@/lib/share";
import { colors, radius, spacing } from "@/theme";
import {
  Body,
  Caption,
  Card,
  DescriptionList,
  EmptyState,
  ErrorState,
  Eyebrow,
  IconTile,
  Label,
  Mono,
  MonoSmall,
  Screen,
  SectionHeader,
  Small,
  Spinner,
} from "@/ui";

function AttemptCard({
  attempt,
  expanded,
  last,
  onToggle,
  timezone,
  wsId,
}: {
  attempt: AttemptSummary;
  expanded: boolean;
  last: boolean;
  onToggle: () => void;
  timezone: string;
  wsId: string;
}) {
  const meta = [
    formatDuration(attempt.durationMs),
    attempt.retryDelaySeconds > 0 ? `waited ${attempt.retryDelaySeconds} s` : null,
    attempt.runnerKind ? runnerLabel(attempt.runnerKind) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={styles.timelineItem}>
      <View style={styles.rail}>
        <View style={[styles.railDot, { backgroundColor: railColor(attempt.status) }]} />
        {!last ? <View style={styles.railLine} /> : null}
      </View>
      <Card padding="none" style={styles.attemptCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={({ pressed }) => [styles.attemptHeader, pressed && styles.pressed]}
          onPress={onToggle}
        >
          <IconTile icon={statusIcon(attempt.status)} size={32} tone={statusTone(attempt.status)} />
          <View style={styles.attemptText}>
            <Body style={styles.attemptTitle}>Attempt {attempt.attemptIndex + 1}</Body>
            <MonoSmall numberOfLines={1}>{meta}</MonoSmall>
          </View>
          <StatusBadge status={attempt.status} />
          <Feather color={colors.textSubtle} name={expanded ? "chevron-up" : "chevron-down"} size={18} />
        </Pressable>
        {expanded ? (
          <View style={styles.attemptBody}>
            <AttemptDetail attemptId={attempt.id} timezone={timezone} wsId={wsId} />
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function railColor(status: AttemptSummary["status"]): string {
  const tone = statusTone(status);
  if (tone === "ok") return colors.ok;
  if (tone === "danger") return colors.danger;
  if (tone === "warn") return colors.warn;
  if (tone === "info") return colors.accent;
  return colors.borderStrong;
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
                  style={({ pressed }) => [styles.headerButton, pressed && styles.dim]}
                  onPress={() => void saveReport()}
                >
                  {downloading ? (
                    <ActivityIndicator color={colors.onInk} size="small" />
                  ) : (
                    <Feather color={colors.onInk} name="download" size={16} />
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
                <MonoSmall color={colors.accentDark}>Browser Tests</MonoSmall>
              </Pressable>
              <MonoSmall>/</MonoSmall>
              {testId ? (
                <Pressable
                  accessibilityRole="link"
                  hitSlop={6}
                  style={styles.crumbLink}
                  onPress={() => router.push(`${base}/tests/${testId}`)}
                >
                  <MonoSmall color={colors.accentDark} numberOfLines={1}>
                    {data.snapshot.name}
                  </MonoSmall>
                </Pressable>
              ) : (
                <MonoSmall>Draft validation</MonoSmall>
              )}
              <MonoSmall>/</MonoSmall>
              <MonoSmall color={colors.textBody}>Run</MonoSmall>
            </View>

            {data.testId === null ? (
              <Card tone="info">
                <View style={styles.noteRow}>
                  <Feather color={colors.accentDark} name="info" size={16} style={styles.noteIcon} />
                  <Small color={colors.textBody} style={styles.noteText}>
                    {draftValidationNote}
                  </Small>
                </View>
              </Card>
            ) : null}

            {hasReport ? <Caption>{reportNote}</Caption> : null}

            <Card elevated eyebrow="Progress">
              <RunStatusPanel runId={runId} wsId={current.id} />
            </Card>

            <Card eyebrow="Run details">
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
                  { label: "Duration", value: <Mono>{formatDuration(data.durationMs)}</Mono> },
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
                  { label: "Model", value: <Mono>{executor?.modelName ?? data.snapshot.modelName}</Mono> },
                  {
                    label: "Runner",
                    value: executor ? (
                      <View>
                        <Body>{runnerLabel(executor.runnerKind)}</Body>
                        {executor.runnerVersion ? (
                          <MonoSmall selectable>{executor.runnerVersion}</MonoSmall>
                        ) : null}
                      </View>
                    ) : (
                      "—"
                    ),
                  },
                ]}
              />
            </Card>

            <Card eyebrow="Instructions used">
              <Body color={colors.textBody} selectable>
                {data.snapshot.instructions}
              </Body>
              <View style={styles.startUrl}>
                <Eyebrow>Starting URL</Eyebrow>
                <Mono color={colors.textBody} selectable style={styles.startUrlText}>
                  {data.snapshot.startUrl}
                </Mono>
              </View>
            </Card>

            <View>
              <SectionHeader title="Attempts" />
              {data.attempts.length === 0 ? (
                <Card>
                  <EmptyState
                    description="The first attempt will appear when the browser starts."
                    icon={<IconTile icon="play" size={44} tone="info" />}
                    title="No attempts yet"
                  />
                </Card>
              ) : (
                <View>
                  {data.attempts.map((attempt, index) => (
                    <AttemptCard
                      key={attempt.id}
                      attempt={attempt}
                      expanded={expandedAttemptId === attempt.id}
                      last={index === data.attempts.length - 1}
                      timezone={timezone}
                      wsId={current.id}
                      onToggle={() =>
                        setExpandedAttemptId((currentId) => (currentId === attempt.id ? null : attempt.id))
                      }
                    />
                  ))}
                </View>
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
  attemptCard: { flex: 1, minWidth: 0 },
  attemptHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  attemptText: { flex: 1, gap: 2, minWidth: 0 },
  attemptTitle: { fontWeight: "500" },
  crumbLink: { flexShrink: 1 },
  crumbs: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dim: { opacity: 0.6 },
  headerButton: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radius.full,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  inline: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  inlineText: { flexShrink: 1 },
  link: { alignSelf: "flex-start" },
  noteIcon: { marginTop: 1 },
  noteRow: { flexDirection: "row", gap: spacing.sm },
  noteText: { flex: 1 },
  pressed: { backgroundColor: colors.zinc50 },
  rail: { alignItems: "center", paddingTop: 22, width: 16 },
  railDot: { borderRadius: 5, height: 10, width: 10 },
  railLine: { backgroundColor: colors.borderStrong, flex: 1, marginTop: spacing.xs, width: 2 },
  stack: { gap: spacing.xl },
  startUrl: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
  startUrlText: { fontSize: 12, lineHeight: 16 },
  timelineItem: { flexDirection: "row", gap: spacing.md, paddingBottom: spacing.md },
});
