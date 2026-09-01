import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { getIncident } from "@/api/incidents";
import type { IncidentDelivery, IncidentDetail } from "@/api/types";
import {
  emptyDeliveriesCopy,
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
import { ChannelTile } from "@/components/notifications/ChannelTile";
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
  Card,
  DescriptionList,
  EmptyState,
  ErrorState,
  IconTile,
  Mono,
  MonoSmall,
  Muted,
  Screen,
  Skeleton,
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
  const details = [
    channelTypeLabels[delivery.channelType],
    incidentDeliveryEvent(delivery.eventType),
    deliveryAttempts(delivery.attemptCount),
  ].join(" · ");

  return (
    <View style={[styles.deliveryRow, last && styles.lastRow]}>
      <ChannelTile
        tone={
          status.tone === "danger"
            ? "danger"
            : status.tone === "warn"
              ? "warn"
              : "plain"
        }
        type={delivery.channelType}
      />
      <View style={styles.deliveryMain}>
        <Body style={styles.deliveryName}>{delivery.channelName}</Body>
        <MonoSmall>{details}</MonoSmall>
        {(delivery.status === "FAILED" || delivery.status === "AMBIGUOUS") &&
        delivery.errorSanitized ? (
          <Mono style={styles.deliveryError}>{delivery.errorSanitized}</Mono>
        ) : null}
      </View>
      <View style={styles.deliverySide}>
        <Badge dot tone={status.tone}>
          {status.label}
        </Badge>
        <MonoSmall>{incidentDeliveryTime(delivery, timezone)}</MonoSmall>
      </View>
    </View>
  );
}

function DetailSkeleton() {
  return (
    <View accessibilityLabel="Loading incident" style={styles.stack}>
      <Card elevated>
        <Skeleton width={90} />
        <Skeleton height={26} style={styles.gapTop} width={220} />
        <Skeleton style={styles.gapTop} />
      </Card>
      <Card>
        <Skeleton width={120} />
        <Skeleton style={styles.gapTop} />
        <Skeleton style={styles.gapTop} width={200} />
      </Card>
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

  const details: DescriptionItem[] = [
    {
      label: "Resource",
      value: (
        <Pressable accessibilityRole="link" onPress={() => go(resourceHref)}>
          <Body color={colors.accentDark}>{incident.resourceName}</Body>
        </Pressable>
      ),
    },
    { label: "Opened", value: formatDateTime(incident.openedAt, timezone) },
    ...(incident.resolvedAt
      ? [{ label: "Resolved", value: formatDateTime(incident.resolvedAt, timezone) }]
      : []),
    { label: "Duration", value: <Mono>{formatDuration(durationMs)}</Mono> },
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
      <Card elevated>
        <View style={styles.summaryTop}>
          <StatusBadge status={incident.status} />
          <Badge tone={resource.tone}>{resource.label}</Badge>
        </View>
        <Title style={styles.summaryTitle}>{incident.resourceName}</Title>
        <Muted style={styles.summaryMeta}>{incidentMeta(incident, durationMs, timezone)}</Muted>
        <View style={styles.actions}>
          {incident.openedByRunId ? (
            <Button
              title="View failing run"
              variant="accent"
              onPress={() => go(`/w/${current.id}/runs/${incident.openedByRunId}`)}
            />
          ) : null}
          <Button
            title={`View ${incidentResourceLabel(incident.resourceType)}`}
            onPress={() => go(resourceHref)}
          />
        </View>
      </Card>

      <Card eyebrow="Details">
        <DescriptionList items={details} />
      </Card>

      <Card title="Timeline">
        <IncidentTimeline
          events={incident.events}
          incident={incident}
          timezone={timezone}
          workspaceId={current.id}
        />
      </Card>

      <Card eyebrow="Notifications sent" padding="none">
        {incident.deliveries.length === 0 ? (
          <EmptyState icon={<IconTile icon="bell-off" size={44} />} title={emptyDeliveriesCopy} />
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
          <DetailSkeleton />
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
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  deliveryError: {
    alignSelf: "flex-start",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    color: colors.dangerDark,
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.xs,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  deliveryMain: { flex: 1, gap: 3, minWidth: 0 },
  deliveryName: { fontWeight: "500" },
  deliveryRow: {
    alignItems: "flex-start",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  deliverySide: { alignItems: "flex-end", gap: spacing.xs + 2 },
  gapTop: { marginTop: spacing.md },
  lastRow: { borderBottomWidth: 0 },
  stack: { gap: spacing.xl },
  summaryMeta: { marginTop: spacing.xs },
  summaryTitle: { marginTop: spacing.md },
  summaryTop: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
