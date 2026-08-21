import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { getIncident } from "@/api/incidents";
import type { IncidentDelivery, IncidentDetail } from "@/api/types";
import {
  emptyDeliveriesCopy,
  incidentDeliveryCost,
  incidentDeliveryEvent,
  incidentDeliveryStatus,
  incidentDeliveryTime,
  incidentMeta,
  incidentResourceHref,
  incidentResourceLabel,
  openedByLink,
} from "@/components/incidents/incident-detail";
import { IncidentTimeline } from "@/components/incidents/IncidentTimeline";
import {
  liveIncidentDuration,
  resourceTypePresentation,
} from "@/components/incidents/incidents-list";
import { useNow } from "@/components/incidents/use-now";
import { channelTypeLabels } from "@/components/notifications/channels";
import { deliveryAttempts } from "@/components/notifications/deliveries";
import { StatusBadge } from "@/components/StatusBadge";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { itemQueryErrorMessage } from "@/lib/errors";
import { formatDateTime, formatDuration } from "@/lib/format";
import { firstParam } from "@/lib/links";
import { colors, radius, spacing } from "@/theme";
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  DescriptionList,
  EmptyState,
  ErrorState,
  Mono,
  Muted,
  Screen,
  Spinner,
  Title,
  type DescriptionItem,
} from "@/ui";

function IncidentDeliveryRow({
  delivery,
  last,
  timezone,
}: {
  delivery: IncidentDelivery;
  last: boolean;
  timezone: string;
}) {
  const status = incidentDeliveryStatus(delivery.status);
  const cost = incidentDeliveryCost(delivery);
  const details = [
    channelTypeLabels[delivery.channelType],
    incidentDeliveryEvent(delivery.eventType),
    deliveryAttempts(delivery.attemptCount),
    ...(cost ? [cost] : []),
  ].join(" · ");

  return (
    <View style={[styles.deliveryRow, last && styles.lastRow]}>
      <View style={styles.deliveryMain}>
        <Body style={styles.deliveryName}>{delivery.channelName}</Body>
        <Caption>{details}</Caption>
        {delivery.status === "FAILED" && delivery.errorSanitized ? (
          <Mono style={styles.deliveryError}>{delivery.errorSanitized}</Mono>
        ) : null}
      </View>
      <View style={styles.deliverySide}>
        <Badge tone={status.tone}>{status.label}</Badge>
        <Caption>{incidentDeliveryTime(delivery, timezone)}</Caption>
      </View>
    </View>
  );
}

function IncidentContent({ incident, now }: { incident: IncidentDetail; now: number }) {
  const router = useRouter();
  const { current, timezone } = useWorkspace();
  const go = (href: string) => router.push(href as Href);
  const durationMs = liveIncidentDuration(incident, now);
  const resource = resourceTypePresentation(incident.resourceType);
  const resourceHref = incidentResourceHref(current.id, incident);
  const openedBy = openedByLink(current.id, incident);

  const summary: DescriptionItem[] = [
    {
      label: "Resource",
      value: (
        <Pressable accessibilityRole="link" onPress={() => go(resourceHref)}>
          <Body color={colors.accentDark}>{incident.resourceName}</Body>
        </Pressable>
      ),
    },
    { label: "Type", value: <Badge tone={resource.tone}>{resource.label}</Badge> },
    { label: "Opened", value: formatDateTime(incident.openedAt, timezone) },
    ...(incident.resolvedAt
      ? [{ label: "Resolved", value: formatDateTime(incident.resolvedAt, timezone) }]
      : []),
    { label: "Duration", value: formatDuration(durationMs) },
    ...(openedBy
      ? [
          {
            label: "Opened by",
            value: (
              <Pressable accessibilityRole="link" onPress={() => go(openedBy.href)}>
                <Mono color={colors.accentDark}>{openedBy.label}</Mono>
              </Pressable>
            ),
          },
        ]
      : []),
  ];

  return (
    <View style={styles.stack}>
      <View style={styles.header}>
        <Title>Incident — {incident.resourceName}</Title>
        <StatusBadge status={incident.status} />
        <Muted>{incidentMeta(incident, durationMs, timezone)}</Muted>
      </View>

      <View style={styles.actions}>
        <Button
          title={`View ${incidentResourceLabel(incident.resourceType)}`}
          onPress={() => go(resourceHref)}
        />
        {incident.openedByRunId ? (
          <Button
            title="View failing run"
            variant="primary"
            onPress={() => go(`/w/${current.id}/runs/${incident.openedByRunId}`)}
          />
        ) : null}
      </View>

      <Card title="Summary">
        <DescriptionList items={summary} />
      </Card>

      <Card title="Timeline">
        <IncidentTimeline
          events={incident.events}
          incident={incident}
          timezone={timezone}
          workspaceId={current.id}
        />
      </Card>

      <Card padding="none" title="Notifications sent">
        {incident.deliveries.length === 0 ? (
          <EmptyState title={emptyDeliveriesCopy} />
        ) : (
          incident.deliveries.map((delivery, index) => (
            <IncidentDeliveryRow
              key={delivery.id}
              delivery={delivery}
              last={index === incident.deliveries.length - 1}
              timezone={timezone}
            />
          ))
        )}
      </Card>
    </View>
  );
}

export default function IncidentDetailScreen() {
  const { current } = useWorkspace();
  const params = useLocalSearchParams<{ incidentId: string }>();
  const incidentId = firstParam(params.incidentId) ?? "";
  const incident = useQuery({
    queryFn: () => getIncident(current.id, incidentId),
    queryKey: ["ws", current.id, "incidents", incidentId],
    refetchInterval: (query) => (query.state.data?.status === "OPEN" ? 30_000 : false),
  });
  const now = useNow(incident.data?.status === "OPEN");

  return (
    <>
      <Stack.Screen options={{ title: "Incident" }} />
      <Screen
        refreshing={incident.isRefetching && !incident.isPending}
        onRefresh={() => void incident.refetch()}
      >
        {incident.isPending ? (
          <Spinner label="Loading incident" />
        ) : incident.isError ? (
          <ErrorState
            message={itemQueryErrorMessage(incident.error)}
            onRetry={() => void incident.refetch()}
          />
        ) : (
          <IncidentContent incident={incident.data} now={now} />
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  deliveryError: {
    alignSelf: "flex-start",
    backgroundColor: colors.zinc100,
    borderRadius: radius.sm,
    color: colors.zinc700,
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.xs,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  deliveryMain: { flex: 1, gap: 2, minWidth: 0 },
  deliveryName: { fontWeight: "500" },
  deliveryRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  deliverySide: { alignItems: "flex-end", gap: spacing.xs },
  header: { alignItems: "flex-start", gap: spacing.sm },
  lastRow: { borderBottomWidth: 0 },
  stack: { gap: spacing.lg },
});
