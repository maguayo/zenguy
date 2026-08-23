import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { getAttempt } from "@/api/tests";
import type { ArtifactRef, Step } from "@/api/types";
import { StatusBadge } from "@/components/StatusBadge";
import { absoluteArtifactUrl } from "@/lib/api";
import { itemQueryErrorMessage } from "@/lib/errors";
import { formatTime } from "@/lib/format";
import { colors, radius, spacing, toneColors, type Tone } from "@/theme";
import { Badge, Body, Caption, Card, ErrorState, Heading, Mono, Muted, Skeleton, Small } from "@/ui";
import { runnerLabel, tokensLabel } from "@/components/tests/labels";
import { ExpectedObserved } from "./ExpectedObserved";
import { ScreenshotViewer } from "./ScreenshotViewer";
import { screenshotItems, type ScreenshotItem } from "./screenshots";

export { screenshotItems } from "./screenshots";

function EmptyCapture() {
  return <Muted style={styles.italic}>None captured</Muted>;
}

function DisclosureCard({
  children,
  count,
  title,
}: {
  children: ReactNode;
  count: number;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card padding="none">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.disclosureHeader, pressed && styles.pressed]}
        onPress={() => setOpen((value) => !value)}
      >
        <Heading style={styles.disclosureTitle}>{`${title} (${count})`}</Heading>
        <Feather color={colors.zinc500} name={open ? "chevron-up" : "chevron-down"} size={18} />
      </Pressable>
      {open ? <View style={styles.disclosureBody}>{children}</View> : null}
    </Card>
  );
}

function ScreenshotThumbnail({
  onOpen,
  screenshot,
  sequence,
}: {
  onOpen: () => void;
  screenshot: ArtifactRef;
  sequence: number;
}) {
  const [expired, setExpired] = useState(false);
  return (
    <Pressable
      accessibilityLabel={`Open step ${sequence} screenshot`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.thumbnail, pressed && styles.thumbnailPressed]}
      onPress={onOpen}
    >
      {expired ? (
        <View style={styles.thumbnailFallback}>
          <Feather color={colors.zinc500} name="image" size={18} />
          <Caption>Screenshot expired</Caption>
        </View>
      ) : (
        <Image
          accessibilityLabel={`Step ${sequence} screenshot`}
          contentFit="cover"
          contentPosition="top"
          source={{ uri: absoluteArtifactUrl(screenshot.url) }}
          style={styles.thumbnailImage}
          transition={120}
          onError={() => setExpired(true)}
        />
      )}
    </Pressable>
  );
}

function StepTimeline({
  onOpenScreenshot,
  screenshots,
  steps,
  timezone,
}: {
  onOpenScreenshot: (index: number) => void;
  screenshots: ScreenshotItem[];
  steps: Step[];
  timezone: string;
}) {
  if (steps.length === 0) return <EmptyCapture />;

  return (
    <View>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const ok = step.result === "OK";
        const screenshotIndex = step.screenshot
          ? screenshots.findIndex((candidate) => candidate.id === step.screenshot?.id)
          : -1;
        return (
          <View key={step.sequence} style={styles.step}>
            <View style={styles.rail}>
              <View style={styles.sequence}>
                <Caption color={colors.zinc700} style={styles.sequenceText}>
                  {step.sequence}
                </Caption>
              </View>
              {!last ? <View style={styles.railLine} /> : null}
            </View>
            <View style={[styles.stepBody, !last && styles.stepBodyGap]}>
              <View style={styles.stepMeta}>
                <Badge>
                  <Mono color={toneColors.neutral.fg} style={styles.actionType}>
                    {step.actionType}
                  </Mono>
                </Badge>
                <View style={[styles.resultDot, { backgroundColor: ok ? colors.ok : colors.danger }]} />
                <Caption color={ok ? colors.okDark : colors.dangerDark} style={styles.resultText}>
                  {ok ? "OK" : "Error"}
                </Caption>
                <Caption style={styles.time}>{formatTime(step.timestamp, timezone)}</Caption>
              </View>
              <Body style={styles.description}>{step.description}</Body>
              {step.urlSanitized ? (
                <Mono color={colors.textMuted} numberOfLines={1} style={styles.url}>
                  {step.urlSanitized}
                </Mono>
              ) : null}
              {step.screenshot ? (
                <ScreenshotThumbnail
                  screenshot={step.screenshot}
                  sequence={step.sequence}
                  onOpen={() => onOpenScreenshot(Math.max(0, screenshotIndex))}
                />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Everything recorded for one attempt: summary, steps, captured errors and URLs. */
export function AttemptDetail({
  attemptId,
  timezone,
  wsId,
}: {
  attemptId: string;
  timezone: string;
  wsId: string;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const attempt = useQuery({
    queryFn: () => getAttempt(wsId, attemptId),
    queryKey: ["ws", wsId, "attempts", attemptId],
  });

  if (attempt.isPending) {
    return (
      <View accessibilityLabel="Loading attempt" accessibilityRole="progressbar" style={styles.skeletons}>
        <Skeleton width="66%" />
        <Skeleton height={64} />
      </View>
    );
  }
  if (attempt.isError) {
    return (
      <ErrorState
        message={itemQueryErrorMessage(attempt.error)}
        onRetry={() => void attempt.refetch()}
      />
    );
  }

  const data = attempt.data;
  const screenshots = screenshotItems(data);
  const failed = data.status === "FAILED" || data.status === "TIMEOUT";
  const tone: Tone = failed ? "danger" : data.status === "PASSED" ? "ok" : "neutral";

  return (
    <View style={styles.stack}>
      <View
        style={[
          styles.summary,
          { backgroundColor: toneColors[tone].bg, borderColor: toneColors[tone].border },
        ]}
      >
        <View style={styles.summaryHeader}>
          <StatusBadge status={data.status} />
          <Body style={styles.summaryText}>{data.summary ?? "No summary was recorded."}</Body>
        </View>
        {failed && data.failureReason ? (
          <View style={styles.reason}>
            <Small color={colors.dangerDark}>{data.failureReason}</Small>
          </View>
        ) : null}
        {failed ? <ExpectedObserved actual={data.actualResult} expected={data.expectedResult} /> : null}
        {data.status === "SYSTEM_ERROR" && data.systemErrorCode ? (
          <Mono color={colors.zinc600} style={styles.gapTop}>
            System error code: {data.systemErrorCode}
          </Mono>
        ) : null}
        <Caption style={styles.gapTop}>
          Tokens: {tokensLabel(data)} · Model: {data.modelName ?? "—"} · Runner:{" "}
          {runnerLabel(data.runnerKind)}
        </Caption>
      </View>

      <Card title="Steps timeline">
        <StepTimeline
          screenshots={screenshots}
          steps={data.steps}
          timezone={timezone}
          onOpenScreenshot={setViewerIndex}
        />
      </Card>

      <DisclosureCard count={data.consoleErrors.length} title="Console errors">
        {data.consoleErrors.length === 0 ? (
          <EmptyCapture />
        ) : (
          <View style={styles.list}>
            {data.consoleErrors.map((error, index) => (
              <Mono key={`${error.timestamp}-${index}`} color={colors.zinc700} selectable>
                <Mono color={colors.zinc700} style={styles.bold}>
                  {error.level}
                </Mono>
                {` · ${error.message} · ${error.url ?? "—"}`}
              </Mono>
            ))}
          </View>
        )}
      </DisclosureCard>

      <DisclosureCard count={data.networkErrors.length} title="Network errors">
        {data.networkErrors.length === 0 ? (
          <EmptyCapture />
        ) : (
          <View style={styles.list}>
            {data.networkErrors.map((error, index) => (
              <View
                key={`${error.method}-${error.host}-${error.path}-${index}`}
                style={[styles.networkRow, index === data.networkErrors.length - 1 && styles.lastRow]}
              >
                <Mono color={colors.zinc700} selectable>
                  {error.method} {error.host}
                </Mono>
                <Mono color={colors.textMuted} numberOfLines={2} selectable>
                  {error.path}
                </Mono>
                <Caption>
                  Status {error.statusCode ?? "—"} · {error.errorType ?? "—"}
                </Caption>
              </View>
            ))}
          </View>
        )}
      </DisclosureCard>

      <DisclosureCard count={data.visitedUrls.length} title="Visited URLs">
        {data.visitedUrls.length === 0 ? (
          <EmptyCapture />
        ) : (
          <View style={styles.list}>
            {data.visitedUrls.map((url, index) => (
              <View key={`${url}-${index}`} style={styles.urlRow}>
                <Mono color={colors.textMuted} style={styles.urlIndex}>
                  {index + 1}.
                </Mono>
                <Mono color={colors.zinc700} selectable style={styles.urlText}>
                  {url}
                </Mono>
              </View>
            ))}
          </View>
        )}
      </DisclosureCard>

      <ScreenshotViewer
        initialIndex={viewerIndex ?? 0}
        open={viewerIndex !== null}
        screenshots={screenshots}
        onClose={() => setViewerIndex(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionType: { fontSize: 12, lineHeight: 16 },
  bold: { fontWeight: "600" },
  description: { color: colors.zinc800, marginTop: spacing.sm },
  disclosureBody: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  disclosureHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  disclosureTitle: { flexShrink: 1, fontSize: 15 },
  gapTop: { marginTop: spacing.md },
  italic: { fontStyle: "italic" },
  lastRow: { borderBottomWidth: 0 },
  list: { gap: spacing.sm },
  networkRow: {
    borderBottomColor: colors.zinc100,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
    paddingBottom: spacing.sm,
  },
  pressed: { backgroundColor: colors.zinc50 },
  rail: { alignItems: "center", width: 32 },
  railLine: { backgroundColor: colors.border, flex: 1, marginTop: spacing.xs, width: StyleSheet.hairlineWidth },
  reason: {
    backgroundColor: "rgba(255, 255, 255, 0.75)",
    borderColor: "#fecaca",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resultDot: { borderRadius: 4, height: 8, width: 8 },
  resultText: { fontWeight: "500" },
  sequence: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  sequenceText: { fontWeight: "600" },
  skeletons: { gap: spacing.sm },
  stack: { gap: spacing.lg },
  step: { flexDirection: "row", gap: spacing.md },
  stepBody: { flex: 1, minWidth: 0, paddingTop: spacing.xs },
  stepBodyGap: { paddingBottom: spacing.xl },
  stepMeta: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summary: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  summaryHeader: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryText: { flex: 1, fontWeight: "500", minWidth: 160 },
  thumbnail: {
    backgroundColor: colors.zinc100,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    height: 96,
    marginTop: spacing.md,
    overflow: "hidden",
    width: 160,
  },
  thumbnailFallback: { alignItems: "center", flex: 1, gap: spacing.xs, justifyContent: "center" },
  thumbnailImage: { height: "100%", width: "100%" },
  thumbnailPressed: { borderColor: colors.accent },
  time: { fontVariant: ["tabular-nums"], marginLeft: "auto" },
  url: { marginTop: spacing.xs },
  urlIndex: { width: 28 },
  urlRow: { flexDirection: "row", gap: spacing.xs },
  urlText: { flex: 1 },
});
