import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { listChannels } from "@/api/channels";
import { listIncidents } from "@/api/incidents";
import type { Check, Incident } from "@/api/types";
import { deleteMonitor, getMonitor, getStats, listChecks } from "@/api/uptime";
import { StatusBadge, statusPresentation } from "@/components/StatusBadge";
import { editMonitorHref, incidentHref, uptimeHref } from "@/components/uptime/links";
import {
  checkSummary,
  checkTicks,
  expectationSummary,
  monitorHeaderLines,
  retriesLabel,
  uptimeTone,
} from "@/components/uptime/monitor-display";
import { ResponseTimeChart } from "@/components/uptime/ResponseTimeChart";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import type { ApiPage } from "@/lib/api";
import { apiErrorMessage, itemQueryErrorMessage } from "@/lib/errors";
import { formatDateTime, formatDuration, formatFrequency, formatPct, formatRelative } from "@/lib/format";
import { firstParam } from "@/lib/links";
import { colors, radius, spacing } from "@/theme";
import {
  ActionMenu,
  Badge,
  Card,
  DescriptionList,
  EmptyState,
  ErrorState,
  IconTile,
  Label,
  ListRow,
  LoadMore,
  Mono,
  MonoSmall,
  PulseStrip,
  Screen,
  Skeleton,
  Spinner,
  StatTile,
  confirm,
} from "@/ui";

export default function MonitorDetailScreen() {
  const params = useLocalSearchParams<{ monitorId: string }>();
  const monitorId = firstParam(params.monitorId) ?? "";
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const handleMutationError = useMutationError();
  const { can, current, timezone } = useWorkspace();
  const [deleted, setDeleted] = useState(false);

  const monitor = useQuery({
    enabled: !deleted,
    queryFn: () => getMonitor(current.id, monitorId),
    queryKey: ["ws", current.id, "monitors", monitorId],
    refetchInterval: 30_000,
  });
  const loaded = monitor.isSuccess && !deleted;
  const stats = useQuery({
    enabled: loaded,
    queryFn: () => getStats(current.id, monitorId),
    queryKey: ["ws", current.id, "monitors", monitorId, "stats"],
    refetchInterval: 60_000,
  });
  const checks = useInfiniteQuery({
    enabled: loaded,
    getNextPageParam: (lastPage: ApiPage<Check>) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listChecks(current.id, monitorId, { cursor: pageParam, limit: 50 }),
    queryKey: ["ws", current.id, "monitors", monitorId, "checks"],
  });
  const incidents = useQuery({
    enabled: loaded,
    queryFn: () => listIncidents(current.id, { type: "uptime" }, null, 100),
    queryKey: ["ws", current.id, "incidents", { type: "uptime" }],
  });
  const channels = useQuery({
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
  });
  const remove = useMutation({ mutationFn: () => deleteMonitor(current.id, monitorId) });

  const deleteCurrentMonitor = async () => {
    const confirmed = await confirm({
      confirmLabel: "Delete",
      destructive: true,
      message: "Its check history stays available with any related incident.",
      title: `Delete "${monitor.data?.name ?? "monitor"}"?`,
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync();
      // Stop observing the deleted monitor before invalidating, so the
      // screen never refetches (and 404s) on its way out.
      setDeleted(true);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "monitors"] });
      toast.success("Monitor deleted");
      router.replace(uptimeHref(current.id));
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const refresh = () => {
    void monitor.refetch();
    if (loaded) {
      void stats.refetch();
      void checks.refetch();
      void incidents.refetch();
    }
  };

  const data = monitor.data;
  const openIncidentId = data?.openIncidentId ?? null;
  const channelNames = new Map((channels.data ?? []).map((channel) => [channel.id, channel.name]));
  const checkRows = checks.data?.pages.flatMap((page) => page.items) ?? [];
  const lastPage = checks.data?.pages[checks.data.pages.length - 1];
  const monitorIncidents = (incidents.data?.items ?? []).filter(
    (incident) => incident.resourceId === monitorId,
  );
  const status = data ? statusPresentation(data.status) : null;
  const ticks = checkTicks(checkRows);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight:
            can("uptime.manage") && data && !deleted
              ? () => (
                  <View style={styles.headerActions}>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      style={styles.headerButton}
                      onPress={() => router.push(editMonitorHref(current.id, monitorId))}
                    >
                      <Label color={colors.accentDark}>Edit</Label>
                    </Pressable>
                    <ActionMenu
                      items={[{ destructive: true, label: "Delete", onSelect: () => void deleteCurrentMonitor() }]}
                      title={data.name}
                    />
                  </View>
                )
              : undefined,
          title: data?.name ?? "Monitor",
        }}
      />
      <Screen
        refreshing={monitor.isRefetching && !monitor.isPending}
        onRefresh={refresh}
      >
        {deleted || monitor.isPending || channels.isPending ? (
          <Spinner label="Loading uptime monitor" />
        ) : monitor.isError ? (
          <ErrorState
            message={itemQueryErrorMessage(monitor.error)}
            onRetry={() => void monitor.refetch()}
          />
        ) : channels.isError ? (
          <ErrorState onRetry={() => void channels.refetch()} />
        ) : data && status ? (
          <View style={styles.stack}>
            <Card elevated padding="lg">
              <View style={styles.statusRow}>
                <Badge dot pulse={status.pulse} size="md" tone={status.tone}>
                  {status.label}
                </Badge>
                {data.checking ? (
                  <Badge dot pulse size="md" tone="info">
                    Checking
                  </Badge>
                ) : null}
              </View>
              <Mono numberOfLines={2} selectable style={styles.url}>
                {data.method} {data.url}
              </Mono>
              <PulseStrip live={data.checking} style={styles.strip} ticks={ticks} />
              <View style={styles.stripFooter}>
                <MonoSmall>
                  {ticks.length === 0
                    ? "No checks yet"
                    : `Last ${ticks.length} ${ticks.length === 1 ? "check" : "checks"}`}
                </MonoSmall>
                <MonoSmall>Next check {formatRelative(data.nextCheckAt)}</MonoSmall>
              </View>
            </Card>

            {openIncidentId ? (
              <Card tone="danger">
                <View style={styles.incidentBanner}>
                  <IconTile icon="alert-octagon" size={32} tone="danger" />
                  <Label color={colors.dangerDark} style={styles.incidentText}>
                    This monitor has an open incident.
                  </Label>
                  <Pressable
                    accessibilityRole="link"
                    hitSlop={6}
                    onPress={() => router.push(incidentHref(current.id, openIncidentId))}
                  >
                    <Label color={colors.dangerDark}>View incident →</Label>
                  </Pressable>
                </View>
              </Card>
            ) : null}

            {stats.isError ? (
              <ErrorState onRetry={() => void stats.refetch()} />
            ) : stats.isPending ? (
              <View style={styles.statGrid}>
                <View style={styles.statRow}>
                  <Skeleton height={84} style={styles.statSkeleton} />
                  <Skeleton height={84} style={styles.statSkeleton} />
                </View>
                <View style={styles.statRow}>
                  <Skeleton height={84} style={styles.statSkeleton} />
                  <Skeleton height={84} style={styles.statSkeleton} />
                </View>
              </View>
            ) : (
              <View style={styles.statGrid}>
                <View style={styles.statRow}>
                  <StatTile label="Uptime 24 h" tone={uptimeTone(stats.data.uptime24h)} value={formatPct(stats.data.uptime24h)} />
                  <StatTile label="Uptime 7 days" tone={uptimeTone(stats.data.uptime7d)} value={formatPct(stats.data.uptime7d)} />
                </View>
                <View style={styles.statRow}>
                  <StatTile label="Uptime 30 days" tone={uptimeTone(stats.data.uptime30d)} value={formatPct(stats.data.uptime30d)} />
                  <StatTile
                    hint="average"
                    label="Response 24 h"
                    value={
                      stats.data.avgResponseTimeMs24h === null
                        ? "—"
                        : `${Math.round(stats.data.avgResponseTimeMs24h)} ms`
                    }
                  />
                </View>
              </View>
            )}

            <Card title="Response time (24 h)">
              {stats.isPending ? (
                <Spinner label="Loading response-time chart" style={styles.chartLoading} />
              ) : stats.isSuccess ? (
                <ResponseTimeChart series={stats.data.series} timezone={timezone} />
              ) : null}
            </Card>

            <Card eyebrow="Configuration">
              <DescriptionList
                items={[
                  {
                    label: "Request",
                    value: (
                      <Mono selectable style={styles.configMono}>
                        {data.method} {data.url}
                      </Mono>
                    ),
                  },
                  {
                    label: "Headers",
                    value: (
                      <View style={styles.headerLines}>
                        {monitorHeaderLines(data).map((line, index) => (
                          <Mono key={`${line}-${index}`} selectable style={styles.configMono}>
                            {line}
                          </Mono>
                        ))}
                      </View>
                    ),
                  },
                  { label: "Expectations", value: expectationSummary(data) },
                  { label: "Frequency", value: formatFrequency(data.frequencySeconds) },
                  { label: "Timeout", value: `${data.timeoutSeconds} seconds` },
                  { label: "Retries", value: retriesLabel(data.maxRetries) },
                  {
                    label: "Channels",
                    value:
                      data.channelIds.length === 0 ? (
                        "None"
                      ) : (
                        <View style={styles.channelBadges}>
                          {data.channelIds.map((id) => (
                            <Badge key={id}>{channelNames.get(id) ?? "Unknown channel"}</Badge>
                          ))}
                        </View>
                      ),
                  },
                  { label: "On recovery", value: data.notifyOnRecovery ? "Notify" : "Stay quiet" },
                ]}
              />
            </Card>

            <Card eyebrow="Recent checks" padding="none">
              {checks.isError ? (
                <ErrorState onRetry={() => void checks.refetch()} />
              ) : checks.isPending ? (
                <Spinner label="Loading checks" />
              ) : checkRows.length === 0 ? (
                <EmptyState
                  description="Checks will appear after the first scheduled request."
                  icon={<IconTile icon="activity" size={44} />}
                  title="No checks yet"
                />
              ) : (
                <>
                  {checkRows.map((check, index) => {
                    const summary = checkSummary(check);
                    return (
                      <ListRow
                        key={check.id}
                        left={<IconTile icon={summary.tone === "ok" ? "check" : "x"} size={28} tone={summary.tone} />}
                        meta={`HTTP ${summary.httpStatus} · ${summary.responseTime}`}
                        right={<Badge tone={summary.tone}>{summary.result}</Badge>}
                        style={index === checkRows.length - 1 && !checks.hasNextPage ? styles.lastRow : undefined}
                        subtitle={
                          check.failureReason ? (
                            <Mono color={colors.dangerDark} style={styles.reason}>
                              {check.failureReason}
                            </Mono>
                          ) : undefined
                        }
                        title={formatDateTime(check.checkedAt, timezone)}
                      />
                    );
                  })}
                  <LoadMore
                    loading={checks.isFetchingNextPage}
                    nextCursor={checks.hasNextPage ? (lastPage?.nextCursor ?? null) : null}
                    onMore={() => void checks.fetchNextPage()}
                  />
                </>
              )}
            </Card>

            <Card eyebrow="Incidents" padding="none">
              {incidents.isPending ? (
                <Spinner label="Loading incidents" />
              ) : incidents.isError ? (
                <ErrorState onRetry={() => void incidents.refetch()} />
              ) : monitorIncidents.length === 0 ? (
                <EmptyState title="No incidents." />
              ) : (
                monitorIncidents.map((incident: Incident, index) => (
                  <ListRow
                    key={incident.id}
                    left={
                      <IconTile
                        icon={incident.status === "OPEN" ? "alert-octagon" : "check"}
                        tone={incident.status === "OPEN" ? "danger" : "ok"}
                      />
                    }
                    meta={formatDuration(incident.durationMs)}
                    style={index === monitorIncidents.length - 1 ? styles.lastRow : undefined}
                    subtitle={<StatusBadge status={incident.status} />}
                    title={`Opened ${formatDateTime(incident.openedAt, timezone)}`}
                    onPress={() => router.push(incidentHref(current.id, incident.id))}
                  />
                ))
              )}
            </Card>
          </View>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  channelBadges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chartLoading: { minHeight: 168 },
  configMono: { fontSize: 12, lineHeight: 16 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  headerButton: { justifyContent: "center", minHeight: 36, paddingHorizontal: spacing.xs },
  headerLines: { gap: 2 },
  incidentBanner: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  incidentText: { flex: 1 },
  lastRow: { borderBottomWidth: 0 },
  reason: { fontSize: 12, lineHeight: 16 },
  stack: { gap: spacing.xl },
  statGrid: { gap: spacing.sm },
  statRow: { flexDirection: "row", gap: spacing.sm },
  statSkeleton: { borderRadius: radius.lg, flex: 1 },
  statusRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  strip: { marginTop: spacing.lg },
  stripFooter: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  url: { color: colors.textBody, marginTop: spacing.md },
});
