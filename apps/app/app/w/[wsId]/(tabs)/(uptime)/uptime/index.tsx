import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import type { Monitor } from "@/api/types";
import { deleteMonitor, listMonitors } from "@/api/uptime";
import { StatusBadge } from "@/components/StatusBadge";
import { editMonitorHref, incidentHref, monitorHref, newMonitorHref } from "@/components/uptime/links";
import { checkTicks, monitorHost, monitorMeta, monitorTile } from "@/components/uptime/monitor-display";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { apiErrorMessage } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { largeTitleOptions } from "@/lib/stack-options";
import { colors, radius, spacing } from "@/theme";
import {
  ActionMenu,
  Badge,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  IconTile,
  ListRow,
  PulseStrip,
  Screen,
  Skeleton,
  confirm,
  type ActionMenuItem,
} from "@/ui";

function MonitorRow({ last, monitor }: { last: boolean; monitor: Monitor }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
  const remove = useMutation({ mutationFn: () => deleteMonitor(current.id, monitor.id) });
  const openIncidentId = monitor.openIncidentId;
  const tile = monitorTile(monitor);

  const removeMonitor = async () => {
    const confirmed = await confirm({
      confirmLabel: "Delete",
      destructive: true,
      message: "Its check history stays available with any related incident.",
      title: `Delete "${monitor.name}"?`,
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "monitors"] });
      toast.success("Monitor deleted");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const items: ActionMenuItem[] = [
    { label: "Open", onSelect: () => router.push(monitorHref(current.id, monitor.id)) },
    ...(can("uptime.manage")
      ? [
          { label: "Edit", onSelect: () => router.push(editMonitorHref(current.id, monitor.id)) },
          { destructive: true, label: "Delete", onSelect: () => void removeMonitor() },
        ]
      : []),
  ];

  return (
    <ListRow
      chevron={false}
      left={<IconTile icon={tile.icon} tone={tile.tone} />}
      meta={monitorMeta(monitor)}
      right={<ActionMenu accessibilityLabel={`Actions for ${monitor.name}`} items={items} title={monitor.name} />}
      style={last ? styles.lastRow : undefined}
      subtitle={
        <View style={styles.meta}>
          <Caption numberOfLines={1}>
            {monitorHost(monitor.url)} ·{" "}
            {monitor.lastCheckAt ? `Last check ${formatRelative(monitor.lastCheckAt)}` : "No checks yet"}
          </Caption>
          <View style={styles.badges}>
            <StatusBadge status={monitor.status} />
            {monitor.checking ? <StatusBadge status="CHECKING" /> : null}
            {openIncidentId ? (
              <Pressable
                accessibilityLabel="Open incident"
                accessibilityRole="link"
                hitSlop={6}
                onPress={() => router.push(incidentHref(current.id, openIncidentId))}
              >
                <Badge dot pulse tone="danger">
                  Open
                </Badge>
              </Pressable>
            ) : null}
          </View>
          <PulseStrip live={monitor.checking} max={20} size="sm" style={styles.strip} ticks={checkTicks(monitor.recentChecks ?? [], 20)} />
        </View>
      }
      title={monitor.name}
      onPress={() => router.push(monitorHref(current.id, monitor.id))}
    />
  );
}

function ListSkeleton() {
  return (
    <Card padding="none" testID="uptime-loading">
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          accessibilityLabel={index === 0 ? "Loading uptime monitors" : undefined}
          style={[styles.skeletonRow, index === 2 && styles.lastRow]}
        >
          <Skeleton height={36} style={styles.skeletonTile} width={36} />
          <View style={styles.skeletonText}>
            <Skeleton width={160} />
            <Skeleton height={12} width={220} />
            <Skeleton height={12} width={120} />
          </View>
        </View>
      ))}
    </Card>
  );
}

export default function UptimeListScreen() {
  const router = useRouter();
  const { can, current } = useWorkspace();
  const monitors = useQuery({
    queryFn: () => listMonitors(current.id),
    queryKey: ["ws", current.id, "monitors"],
    refetchInterval: 30_000,
  });
  const manage = can("uptime.manage");
  const newHref = newMonitorHref(current.id);

  return (
    <>
      <Stack.Screen
        options={{
          ...largeTitleOptions,
          headerRight: manage
            ? () => (
                <Pressable
                  accessibilityLabel="New monitor"
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                  onPress={() => router.push(newHref)}
                >
                  <Feather color={colors.onInk} name="plus" size={18} />
                </Pressable>
              )
            : undefined,
          title: "Uptime",
        }}
      />
      <Screen
        refreshing={monitors.isRefetching && !monitors.isPending}
        onRefresh={() => void monitors.refetch()}
      >
        {monitors.isPending ? (
          <ListSkeleton />
        ) : monitors.isError ? (
          <ErrorState onRetry={() => void monitors.refetch()} />
        ) : monitors.data.length === 0 ? (
          <Card elevated>
            <EmptyState
              action={
                manage ? (
                  <Button
                    title="Create your first monitor"
                    variant="accent"
                    onPress={() => router.push(newHref)}
                  />
                ) : undefined
              }
              description="Ping an endpoint on a schedule and get alerted when it goes down. Uptime checks never consume runs."
              icon={<IconTile icon="activity" size={44} tone="accent" />}
              title="No uptime monitors yet"
            />
          </Card>
        ) : (
          <Card
            eyebrow={`${monitors.data.length} ${monitors.data.length === 1 ? "monitor" : "monitors"}`}
            padding="none"
          >
            {monitors.data.map((monitor, index) => (
              <MonitorRow key={monitor.id} last={index === monitors.data.length - 1} monitor={monitor} />
            ))}
          </Card>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  strip: { marginTop: 2, maxWidth: 220 },
  badges: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
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
});
