import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import type { Monitor } from "@/api/types";
import { deleteMonitor, listMonitors } from "@/api/uptime";
import { StatusBadge } from "@/components/StatusBadge";
import { editMonitorHref, incidentHref, monitorHref, newMonitorHref } from "@/components/uptime/links";
import { formatResponseTime, monitorHost } from "@/components/uptime/monitor-display";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { apiErrorMessage } from "@/lib/errors";
import { formatFrequency, formatRelative } from "@/lib/format";
import { largeTitleOptions } from "@/lib/stack-options";
import { colors, spacing } from "@/theme";
import {
  ActionMenu,
  Badge,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  Spinner,
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
      right={<ActionMenu accessibilityLabel={`Actions for ${monitor.name}`} items={items} title={monitor.name} />}
      style={last ? styles.lastRow : undefined}
      subtitle={
        <View style={styles.meta}>
          <Caption numberOfLines={1}>
            {monitorHost(monitor.url)} · {formatFrequency(monitor.frequencySeconds)}
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
                <Badge dot tone="danger">
                  Open
                </Badge>
              </Pressable>
            ) : null}
          </View>
          <Caption>
            {monitor.lastCheckAt ? `Last check ${formatRelative(monitor.lastCheckAt)}` : "No checks yet"} ·{" "}
            {formatResponseTime(monitor.lastResponseTimeMs)}
          </Caption>
        </View>
      }
      title={monitor.name}
      onPress={() => router.push(monitorHref(current.id, monitor.id))}
    />
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
                  <Feather color={colors.accent} name="plus" size={24} />
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
          <Spinner label="Loading uptime monitors" />
        ) : monitors.isError ? (
          <ErrorState onRetry={() => void monitors.refetch()} />
        ) : monitors.data.length === 0 ? (
          <Card padding="none">
            <EmptyState
              action={
                manage ? (
                  <Button
                    title="Create your first monitor"
                    variant="primary"
                    onPress={() => router.push(newHref)}
                  />
                ) : undefined
              }
              description="Ping an endpoint on a schedule and get alerted when it goes down. Uptime checks never consume runs."
              icon={<Feather color={colors.zinc400} name="activity" size={24} />}
              title="No uptime monitors yet"
            />
          </Card>
        ) : (
          <Card padding="none">
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
  badges: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  headerButton: { alignItems: "center", borderRadius: 8, height: 36, justifyContent: "center", width: 36 },
  lastRow: { borderBottomWidth: 0 },
  meta: { gap: spacing.xs + 1 },
  pressed: { backgroundColor: colors.zinc100 },
});
