import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { getAttempt, getRun } from "@/api/tests";
import { StatusBadge } from "@/components/StatusBadge";
import { absoluteArtifactUrl } from "@/lib/api";
import { itemQueryErrorMessage } from "@/lib/errors";
import { formatDuration } from "@/lib/format";
import { colors, radius, spacing, toneColors } from "@/theme";
import { Badge, Card, ErrorState, Label, Mono, MonoSmall, Muted, Skeleton, Small } from "@/ui";
import { ExpectedObserved } from "./ExpectedObserved";
import { attemptCountLabel, attemptSymbol, elapsedMs, isTerminalRun } from "./run-status";
import { statusTone } from "./status-icon";

export { attemptSymbol, isTerminalRun } from "./run-status";

export interface RunStatusPanelProps {
  compact?: boolean;
  onTerminal?: () => void;
  runId: string;
  wsId: string;
}

/**
 * Live progress of a run. Polls every 2 s while the run is queued or running
 * (the web's SSE stream has no native equivalent here).
 */
export function RunStatusPanel({ compact = false, onTerminal, runId, wsId }: RunStatusPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const run = useQuery({
    queryFn: () => getRun(wsId, runId),
    queryKey: ["ws", wsId, "runs", runId],
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !isTerminalRun(status) ? 2_000 : false;
    },
  });
  const runData = run.data;
  const latestAttempt = runData?.attempts[runData.attempts.length - 1];
  const needsAttemptDetail =
    latestAttempt !== undefined &&
    runData !== undefined &&
    (runData.status === "FAILED" || runData.status === "TIMEOUT");
  const attemptDetail = useQuery({
    enabled: needsAttemptDetail,
    queryFn: () => getAttempt(wsId, latestAttempt?.id ?? ""),
    queryKey: ["ws", wsId, "attempts", latestAttempt?.id],
  });
  const status = runData?.status;
  const active = status !== undefined && !isTerminalRun(status);
  const startedAt = runData?.startedAt ?? null;

  useEffect(() => {
    if (!active || !startedAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  useEffect(() => {
    if (status && isTerminalRun(status)) onTerminal?.();
  }, [onTerminal, status]);

  if (run.isPending) {
    return (
      <View accessibilityLabel="Loading validation run" accessibilityRole="progressbar" style={styles.stack}>
        <Skeleton height={20} width={112} />
        <Skeleton height={64} />
      </View>
    );
  }
  if (run.isError) {
    return (
      <ErrorState message={itemQueryErrorMessage(run.error)} onRetry={() => void run.refetch()} />
    );
  }

  const data = run.data;
  const latestStep = latestAttempt?.latestStep;
  const latestScreenshot = latestAttempt?.latestScreenshot;
  const elapsed = formatDuration(elapsedMs(data, now));
  const detail = attemptDetail.data;
  const hasResults = detail !== undefined && Boolean(detail.expectedResult || detail.actualResult);

  return (
    <View style={styles.stack}>
      <View style={styles.header}>
        <View style={styles.statusRow}>
          <StatusBadge passedAfterRetry={data.passedAfterRetry} status={data.status} />
          {active ? (
            <Badge dot pulse tone="info">
              Live
            </Badge>
          ) : null}
        </View>
        <MonoSmall>
          {elapsed} · {attemptCountLabel(data.attemptCount)}
        </MonoSmall>
      </View>

      {!compact && data.attempts.length > 0 ? (
        <ScrollView contentContainerStyle={styles.attempts} horizontal showsHorizontalScrollIndicator={false}>
          {data.attempts.map((attempt) => {
            const tone = toneColors[statusTone(attempt.status)];
            return (
              <View key={attempt.id} style={[styles.attempt, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                <Label color={tone.fg}>{`Attempt ${attempt.attemptIndex + 1} ${attemptSymbol(attempt.status)}`}</Label>
                {attempt.retryDelaySeconds > 0 ? (
                  <MonoSmall color={tone.fg}>waited {attempt.retryDelaySeconds} s</MonoSmall>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {latestStep ? (
        <View style={styles.stepBox}>
          <Mono color={colors.textMuted} style={styles.stepAction}>
            {latestStep.actionType}
          </Mono>
          <Small color={colors.textBody}>{latestStep.description}</Small>
        </View>
      ) : active ? (
        <Muted>Waiting for the browser to start…</Muted>
      ) : null}

      {latestScreenshot ? (
        <Image
          accessibilityLabel="Latest validation screenshot"
          cachePolicy="memory"
          contentFit="cover"
          contentPosition="top"
          source={{ uri: absoluteArtifactUrl(latestScreenshot.url) }}
          style={[styles.screenshot, compact && styles.screenshotCompact]}
          transition={150}
        />
      ) : null}

      {data.status === "PASSED" ? (
        <Card padding="sm" tone="ok">
          <Label color={colors.okDark}>Passed</Label>
        </Card>
      ) : null}

      {data.status === "FAILED" || data.status === "TIMEOUT" ? (
        <Card padding="sm" tone="danger">
          <Label color={colors.dangerDark}>
            {latestAttempt?.failureReason ??
              (data.status === "TIMEOUT" ? "The attempt timed out." : "The test failed.")}
          </Label>
          {needsAttemptDetail && attemptDetail.isPending ? (
            <View accessibilityLabel="Loading failure details" accessibilityRole="progressbar" style={styles.gapTop}>
              <Skeleton height={56} />
            </View>
          ) : needsAttemptDetail && attemptDetail.isError ? (
            <ErrorState
              message={itemQueryErrorMessage(attemptDetail.error)}
              style={styles.gapTop}
              onRetry={() => void attemptDetail.refetch()}
            />
          ) : detail && hasResults ? (
            <ExpectedObserved actual={detail.actualResult} expected={detail.expectedResult} />
          ) : null}
        </Card>
      ) : null}

      {data.status === "SYSTEM_ERROR" ? (
        <Card padding="sm" tone="neutral">
          <Small color={colors.textBody} style={styles.medium}>
            System error on our side — this run is not billed and no incident was opened.
          </Small>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  attempt: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
    minWidth: 128,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  attempts: { flexDirection: "row", gap: spacing.sm, paddingBottom: spacing.xs },
  gapTop: { marginTop: spacing.md },
  header: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  medium: { fontWeight: "500" },
  screenshot: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    height: 220,
    width: "100%",
  },
  screenshotCompact: { height: 160 },
  stack: { gap: spacing.md },
  statusRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  stepAction: { fontSize: 11, lineHeight: 14, textTransform: "uppercase" },
  stepBox: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.md,
    gap: 3,
    paddingHorizontal: 14,
    paddingVertical: spacing.md - 2,
  },
});
