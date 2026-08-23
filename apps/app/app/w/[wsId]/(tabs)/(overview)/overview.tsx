import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { getOverview } from "@/api/overview";
import type { ActivityItem, ActivityType, Overview } from "@/api/types";
import { UsageMeter } from "@/components/UsageMeter";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatRelative } from "@/lib/format";
import { largeTitleOptions } from "@/lib/stack-options";
import { colors, spacing, toneColors, type Tone } from "@/theme";
import {
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  Hero,
  IconTile,
  Label,
  MonoSmall,
  PulseStrip,
  Screen,
  SectionHeader,
  Skeleton,
  StatTile,
  type FeatherIconName,
  type PulseTick,
} from "@/ui";

interface ActivityPresentation {
  bg: string;
  fg: string;
  icon: FeatherIconName;
  tone: Tone;
}

function presentation(tone: Tone, icon: FeatherIconName): ActivityPresentation {
  return { bg: toneColors[tone].bg, fg: toneColors[tone].fg, icon, tone };
}

export const activityPresentation: Record<ActivityType, ActivityPresentation> = {
  CHANNEL_DELIVERY_FAILED: presentation("warn", "bell-off"),
  MONITOR_DOWN: presentation("danger", "alert-octagon"),
  MONITOR_RECOVERED: presentation("ok", "activity"),
  TEST_FAILED: presentation("danger", "x-circle"),
  TEST_PASSED: presentation("ok", "check-circle"),
  TEST_RECOVERED: presentation("ok", "activity"),
  TEST_SYSTEM_ERROR: presentation("neutral", "tool"),
  TEST_TIMEOUT: presentation("warn", "clock"),
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

/** The hero's one line: loud only when something needs a human. */
export function heroHeadline(overview: Overview): { subtitle: string; title: string } {
  const incidents = overview.browserTests.openIncidents + overview.uptime.openIncidents;
  const monitors = overview.uptime.up + overview.uptime.down + overview.uptime.unknown;
  const parts = [
    `${overview.browserTests.total} ${browserTestNoun(overview.browserTests.total)}`,
    `${monitors} ${monitors === 1 ? "monitor" : "monitors"}`,
  ];
  if (overview.browserTests.runningRuns > 0) parts.push(`${overview.browserTests.runningRuns} running`);
  const subtitle = parts.join(" · ");
  if (overview.uptime.down > 0) {
    return { subtitle, title: overview.uptime.down === 1 ? "1 monitor is down." : `${overview.uptime.down} monitors are down.` };
  }
  if (incidents > 0) return { subtitle, title: incidents === 1 ? "1 incident open." : `${incidents} incidents open.` };
  if (overview.browserTests.total === 0 && monitors === 0) return { subtitle: "Add a browser test or a monitor to start watching.", title: "Nothing to watch yet." };
  return { subtitle, title: "All clear." };
}

/** Oldest first, so the strip reads left-to-right like a timeline. */
export function activityTicks(activity: ActivityItem[]): PulseTick[] {
  return [...activity]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .map((item) => ({ key: activityKey(item), tone: activityPresentation[item.type].tone }));
}

function OverviewSkeleton() {
  return (
    <View accessibilityLabel="Loading overview" style={styles.stack}>
      <View style={styles.skeletonHero}>
        <Skeleton style={styles.skeletonOnInk} width={120} />
        <Skeleton height={34} style={[styles.skeletonOnInk, styles.gapTop]} width={200} />
        <Skeleton height={18} style={[styles.skeletonOnInk, styles.gapTopLg]} />
      </View>
      {[0, 1].map((index) => (
        <View key={index} style={styles.tiles}>
          <Skeleton height={84} style={styles.skeletonTile} />
          <Skeleton height={84} style={styles.skeletonTile} />
          <Skeleton height={84} style={styles.skeletonTile} />
        </View>
      ))}
      <Card>
        <Skeleton width={140} />
        <Skeleton style={styles.gapTop} />
        <Skeleton style={styles.gapTop} width={220} />
      </Card>
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
          <OverviewBody base={base} canManage={can("tests.manage")} data={overview.data} timezone={timezone} workspaceName={current.name} onNavigate={(path) => router.push(path)} />
        )}
      </Screen>
    </>
  );
}

function OverviewBody({
  base,
  canManage,
  data,
  onNavigate,
  timezone,
  workspaceName,
}: {
  base: string;
  canManage: boolean;
  data: Overview;
  onNavigate: (path: string) => void;
  timezone: string;
  workspaceName: string;
}) {
  const headline = heroHeadline(data);
  const ticks = activityTicks(data.activity);
  const openIncidents = data.browserTests.openIncidents + data.uptime.openIncidents;
  return (
    <View style={styles.stack}>
      <Hero eyebrow={workspaceName} subtitle={headline.subtitle} title={headline.title}>
        <PulseStrip live={data.browserTests.runningRuns > 0} onInk ticks={ticks} />
        <View style={styles.heroFooter}>
          <MonoSmall color={colors.onInkSubtle}>
            {ticks.length === 0 ? "No results yet" : `Last ${ticks.length} results`}
          </MonoSmall>
          {openIncidents > 0 ? (
            <Pressable accessibilityRole="link" hitSlop={8} onPress={() => onNavigate(`${base}/incidents?status=open`)}>
              <Label color={colors.onInk}>Open incidents →</Label>
            </Pressable>
          ) : null}
        </View>
      </Hero>

      <View>
        <SectionHeader
          action={
            <Pressable accessibilityRole="link" hitSlop={8} onPress={() => onNavigate(`${base}/tests`)}>
              <Label color={colors.accentDark}>All tests →</Label>
            </Pressable>
          }
          title="Browser tests"
        />
        <View style={styles.tiles}>
          <StatTile label="Tests" value={data.browserTests.total} onPress={() => onNavigate(`${base}/tests`)} />
          <StatTile
            label="Running"
            tone={data.browserTests.runningRuns > 0 ? "info" : "neutral"}
            value={data.browserTests.runningRuns}
          />
          <StatTile
            label="Failed 24h"
            tone={data.browserTests.failed24h > 0 ? "danger" : "neutral"}
            value={data.browserTests.failed24h}
            onPress={
              data.browserTests.openIncidents > 0
                ? () => onNavigate(`${base}/incidents?status=open&type=browser`)
                : undefined
            }
          />
        </View>
      </View>

      <View>
        <SectionHeader
          action={
            <Pressable accessibilityRole="link" hitSlop={8} onPress={() => onNavigate(`${base}/uptime`)}>
              <Label color={colors.accentDark}>All monitors →</Label>
            </Pressable>
          }
          title="Uptime"
        />
        <View style={styles.tiles}>
          <StatTile label="Up" tone={data.uptime.up > 0 ? "ok" : "neutral"} value={data.uptime.up} onPress={() => onNavigate(`${base}/uptime`)} />
          <StatTile
            label="Down"
            tone={data.uptime.down > 0 ? "danger" : "neutral"}
            value={data.uptime.down}
            onPress={
              data.uptime.openIncidents > 0
                ? () => onNavigate(`${base}/incidents?status=open&type=uptime`)
                : undefined
            }
          />
          <StatTile
            label="Avg · 24h"
            value={data.uptime.avgResponseTimeMs24h === null ? "—" : `${Math.round(data.uptime.avgResponseTimeMs24h)} ms`}
          />
        </View>
      </View>

      <Card title="Usage this cycle">
        <UsageMeter timezone={timezone} usage={data.usage} />
      </Card>

      <Card eyebrow="Recent activity" padding="none">
        {data.activity.length === 0 ? (
          <EmptyState
            action={
              canManage ? (
                <Button title="Create your first test" variant="accent" onPress={() => onNavigate(`${base}/tests/new`)} />
              ) : undefined
            }
            description="Create your first browser test to see activity here."
            icon={<IconTile icon="globe" size={44} tone="accent" />}
            title="No activity yet"
          />
        ) : (
          data.activity.map((item, index) => {
            const look = activityPresentation[item.type];
            return (
              <Pressable
                key={activityKey(item)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.activityRow,
                  index === data.activity.length - 1 && styles.lastRow,
                  pressed && styles.pressed,
                ]}
                onPress={() => onNavigate(activityPath(base.slice(3), item))}
              >
                <IconTile icon={look.icon} tone={look.tone} />
                <View style={styles.activityText}>
                  <Body numberOfLines={1} style={styles.activityTitle}>
                    {item.title}
                  </Body>
                  <Caption numberOfLines={1}>{item.resourceName}</Caption>
                </View>
                <MonoSmall>{formatRelative(item.occurredAt)}</MonoSmall>
              </Pressable>
            );
          })
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
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
  gapTop: { marginTop: spacing.md },
  gapTopLg: { marginTop: spacing.lg },
  heroFooter: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md },
  lastRow: { borderBottomWidth: 0 },
  pressed: { backgroundColor: colors.zinc50 },
  skeletonHero: { backgroundColor: colors.ink, borderRadius: 20, padding: spacing.xl },
  skeletonOnInk: { backgroundColor: colors.inkCard },
  skeletonTile: { borderRadius: 14, flex: 1 },
  stack: { gap: spacing.xl },
  tiles: { flexDirection: "row", gap: spacing.sm },
});
