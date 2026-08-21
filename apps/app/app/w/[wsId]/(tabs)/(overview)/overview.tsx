import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { getOverview } from "@/api/overview";
import type { ActivityItem, ActivityType } from "@/api/types";
import { UsageMeter } from "@/components/UsageMeter";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatRelative } from "@/lib/format";
import { largeTitleOptions } from "@/lib/stack-options";
import { colors, radius, spacing } from "@/theme";
import {
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  Heading,
  Label,
  Muted,
  Screen,
  Skeleton,
} from "@/ui";

type FeatherName = ComponentProps<typeof Feather>["name"];

interface ActivityPresentation {
  bg: string;
  fg: string;
  icon: FeatherName;
}

export const activityPresentation: Record<ActivityType, ActivityPresentation> = {
  CHANNEL_DELIVERY_FAILED: { bg: colors.warnSoft, fg: colors.warn, icon: "bell-off" },
  MONITOR_DOWN: { bg: colors.dangerSoft, fg: colors.dangerDark, icon: "alert-octagon" },
  MONITOR_RECOVERED: { bg: colors.okSoft, fg: colors.okDark, icon: "activity" },
  TEST_FAILED: { bg: colors.dangerSoft, fg: colors.dangerDark, icon: "x-circle" },
  TEST_PASSED: { bg: colors.okSoft, fg: colors.okDark, icon: "check-circle" },
  TEST_RECOVERED: { bg: colors.okSoft, fg: colors.okDark, icon: "activity" },
  TEST_SYSTEM_ERROR: { bg: colors.zinc100, fg: colors.zinc600, icon: "tool" },
  TEST_TIMEOUT: { bg: colors.warnSoft, fg: colors.warn, icon: "clock" },
};

export function activityPath(workspaceId: string, item: ActivityItem): string {
  if (item.link.runId) return `/w/${workspaceId}/runs/${item.link.runId}`;
  if (item.link.incidentId) return `/w/${workspaceId}/incidents/${item.link.incidentId}`;
  if (item.link.monitorId) return `/w/${workspaceId}/uptime/${item.link.monitorId}`;
  if (item.link.channelId) return `/w/${workspaceId}/notifications?channel=${item.link.channelId}`;
  return `/w/${workspaceId}/overview`;
}

export function activityKey(item: ActivityItem): string {
  return `${item.id}:${item.type}:${item.occurredAt}`;
}

export function browserTestNoun(count: number): "test" | "tests" {
  return count === 1 ? "test" : "tests";
}

function StatRow({
  danger = false,
  label,
  onPress,
  value,
}: {
  danger?: boolean;
  label: string;
  onPress?: () => void;
  value: string | number;
}) {
  return (
    <Pressable disabled={!onPress} style={styles.statRow} onPress={onPress}>
      <View style={styles.statLabel}>
        <View style={[styles.statDot, { backgroundColor: danger ? colors.danger : colors.zinc300 }]} />
        <Muted>{label}</Muted>
      </View>
      <Body color={danger ? colors.dangerDark : colors.text} style={styles.statValue}>
        {value}
      </Body>
    </Pressable>
  );
}

function OverviewSkeleton() {
  return (
    <View accessibilityLabel="Loading overview" style={styles.stack}>
      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <Skeleton width={110} />
          <Skeleton height={28} style={styles.gapTop} width={140} />
          <View style={[styles.gapTop, styles.skeletonRows]}>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </View>
        </Card>
      ))}
    </View>
  );
}

export default function OverviewScreen() {
  const router = useRouter();
  const { can, current, timezone } = useWorkspace();
  const overview = useQuery({
    queryFn: () => getOverview(current.id),
    queryKey: ["ws", current.id, "overview"],
    refetchInterval: 30_000,
  });
  const base = `/w/${current.id}`;

  return (
    <>
      <Stack.Screen options={{ ...largeTitleOptions, title: "Overview" }} />
      <Screen
        refreshing={overview.isRefetching && !overview.isPending}
        onRefresh={() => void overview.refetch()}
      >
        {overview.isPending ? (
          <OverviewSkeleton />
        ) : overview.isError ? (
          <ErrorState onRetry={() => void overview.refetch()} />
        ) : (
          <View style={styles.stack}>
            <Caption style={styles.workspace}>{current.name}</Caption>

            <Card title="Usage this cycle">
              <UsageMeter timezone={timezone} usage={overview.data.usage} />
            </Card>

            <Card title="Browser tests">
              <View style={styles.bigRow}>
                <Heading style={styles.big}>{overview.data.browserTests.total}</Heading>
                <Muted> {browserTestNoun(overview.data.browserTests.total)}</Muted>
              </View>
              <View style={styles.stats}>
                <StatRow label="Running now" value={overview.data.browserTests.runningRuns} />
                <StatRow
                  danger={overview.data.browserTests.openIncidents > 0}
                  label="Open incidents"
                  value={overview.data.browserTests.openIncidents}
                  onPress={
                    overview.data.browserTests.openIncidents > 0
                      ? () => router.push(`${base}/incidents?status=open&type=browser`)
                      : undefined
                  }
                />
                <StatRow
                  danger={overview.data.browserTests.failed24h > 0}
                  label="Failures (24 h)"
                  value={overview.data.browserTests.failed24h}
                />
              </View>
              <Pressable accessibilityRole="link" style={styles.cardLink} onPress={() => router.push(`${base}/tests`)}>
                <Label color={colors.accentDark}>View tests →</Label>
              </Pressable>
            </Card>

            <Card title="Uptime">
              <View style={styles.uptimeGrid}>
                {(
                  [
                    ["UP", overview.data.uptime.up, colors.okDark],
                    ["DOWN", overview.data.uptime.down, colors.dangerDark],
                    ["UNKNOWN", overview.data.uptime.unknown, colors.zinc600],
                  ] as const
                ).map(([label, value, color]) => (
                  <View key={label} style={styles.uptimeCell}>
                    <Heading color={color}>{value}</Heading>
                    <Caption style={styles.uptimeLabel}>{label}</Caption>
                  </View>
                ))}
              </View>
              <View style={styles.stats}>
                <StatRow
                  danger={overview.data.uptime.openIncidents > 0}
                  label="Open incidents"
                  value={overview.data.uptime.openIncidents}
                  onPress={
                    overview.data.uptime.openIncidents > 0
                      ? () => router.push(`${base}/incidents?status=open&type=uptime`)
                      : undefined
                  }
                />
                <StatRow
                  label="Avg response (24 h)"
                  value={
                    overview.data.uptime.avgResponseTimeMs24h === null
                      ? "—"
                      : `${Math.round(overview.data.uptime.avgResponseTimeMs24h)} ms`
                  }
                />
              </View>
              <Pressable accessibilityRole="link" style={styles.cardLink} onPress={() => router.push(`${base}/uptime`)}>
                <Label color={colors.accentDark}>View monitors →</Label>
              </Pressable>
            </Card>

            <Card padding="none" title="Recent activity">
              {overview.data.activity.length === 0 ? (
                <EmptyState
                  action={
                    can("tests.manage") ? (
                      <Button
                        title="Create your first test"
                        variant="primary"
                        onPress={() => router.push(`${base}/tests/new`)}
                      />
                    ) : undefined
                  }
                  description="Create your first browser test to see activity here."
                  icon={<Feather color={colors.zinc400} name="globe" size={24} />}
                  title="No activity yet"
                />
              ) : (
                overview.data.activity.map((item, index) => {
                  const presentation = activityPresentation[item.type];
                  return (
                    <Pressable
                      key={activityKey(item)}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.activityRow,
                        index === overview.data.activity.length - 1 && styles.lastRow,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => router.push(activityPath(current.id, item))}
                    >
                      <View style={[styles.activityIcon, { backgroundColor: presentation.bg }]}>
                        <Feather color={presentation.fg} name={presentation.icon} size={16} />
                      </View>
                      <View style={styles.activityText}>
                        <Body numberOfLines={1} style={styles.activityTitle}>
                          {item.title}
                        </Body>
                        <Caption numberOfLines={1}>{item.resourceName}</Caption>
                      </View>
                      <Caption>{formatRelative(item.occurredAt)}</Caption>
                    </Pressable>
                  );
                })
              )}
            </Card>
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  activityIcon: { alignItems: "center", borderRadius: radius.full, height: 32, justifyContent: "center", width: 32 },
  activityRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  activityText: { flex: 1, gap: 2 },
  activityTitle: { fontWeight: "500" },
  big: { fontSize: 30, lineHeight: 36 },
  bigRow: { alignItems: "baseline", flexDirection: "row" },
  cardLink: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.lg, paddingTop: spacing.md },
  gapTop: { marginTop: spacing.md },
  lastRow: { borderBottomWidth: 0 },
  pressed: { backgroundColor: colors.zinc50 },
  skeletonRows: { gap: spacing.sm },
  stack: { gap: spacing.lg },
  statDot: { borderRadius: 4, height: 8, width: 8 },
  statLabel: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  statRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  statValue: { fontWeight: "500" },
  stats: { gap: spacing.sm + 2, marginTop: spacing.lg },
  uptimeCell: { alignItems: "center", backgroundColor: colors.zinc50, borderRadius: radius.md, flex: 1, paddingVertical: spacing.sm },
  uptimeGrid: { flexDirection: "row", gap: spacing.sm },
  uptimeLabel: { fontWeight: "500" },
  workspace: { marginTop: -spacing.sm },
});
