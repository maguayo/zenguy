import { useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import type { Delivery } from "@/api/types";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";
import { Badge, Caption, Label, Mono } from "@/ui";

import {
  deliveryAttempts,
  deliveryCostLabel,
  deliveryEvent,
  deliveryIncidentHref,
} from "./deliveries";

/** One delivery in a channel's history: event, outcome, timings and evidence. */
export function DeliveryRow({
  delivery,
  last = false,
  timezone,
  workspaceId,
}: {
  delivery: Delivery;
  last?: boolean;
  timezone: string;
  workspaceId: string;
}) {
  const router = useRouter();
  const event = deliveryEvent(delivery.eventType);
  const cost = deliveryCostLabel(delivery);
  const incidentHref = deliveryIncidentHref(workspaceId, delivery);

  return (
    <View style={[styles.row, last && styles.last]}>
      <View style={styles.top}>
        <Badge tone={event.tone}>{event.label}</Badge>
        <Caption>{formatDateTime(delivery.createdAt, timezone)}</Caption>
      </View>
      <View style={styles.meta}>
        <StatusBadge status={delivery.status} />
        <Caption>{deliveryAttempts(delivery.attemptCount)}</Caption>
        {cost ? <Caption>{cost}</Caption> : null}
      </View>
      {delivery.sentAt ? <Caption>Sent {formatDateTime(delivery.sentAt, timezone)}</Caption> : null}
      {delivery.providerMessageId ? (
        <Mono color={colors.textMuted} numberOfLines={1} style={styles.messageId}>
          {delivery.providerMessageId}
        </Mono>
      ) : null}
      {delivery.status === "FAILED" && delivery.errorSanitized ? (
        <Mono style={styles.error}>{delivery.errorSanitized}</Mono>
      ) : null}
      {incidentHref ? (
        <Pressable
          accessibilityLabel="Open incident"
          accessibilityRole="link"
          hitSlop={4}
          style={styles.incidentLink}
          onPress={() => router.push(incidentHref as Href)}
        >
          <Label color={colors.accentDark}>Open incident →</Label>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    alignSelf: "flex-start",
    backgroundColor: colors.zinc100,
    borderRadius: radius.sm,
    color: colors.zinc700,
    fontSize: 12,
    lineHeight: 16,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  incidentLink: { alignSelf: "flex-start", marginTop: 2 },
  last: { borderBottomWidth: 0 },
  messageId: { fontSize: 12, lineHeight: 16 },
  meta: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  row: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  top: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
});
