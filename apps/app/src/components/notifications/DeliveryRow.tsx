import { useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import type { Delivery } from "@/api/types";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";
import { Badge, IconTile, Label, Mono, MonoSmall, type FeatherIconName } from "@/ui";

import {
  deliveryAttempts,
  deliveryCostLabel,
  deliveryEvent,
  deliveryIncidentHref,
} from "./deliveries";

const eventIcons: Record<Delivery["eventType"], FeatherIconName> = {
  FAILURE: "alert-octagon",
  RECOVERY: "activity",
  TEST: "send",
};

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
  const meta = [deliveryAttempts(delivery.attemptCount), ...(cost ? [cost] : [])].join(" · ");

  return (
    <View style={[styles.row, last && styles.last]}>
      <IconTile icon={eventIcons[delivery.eventType]} tone={event.tone} />
      <View style={styles.main}>
        <View style={styles.top}>
          <Badge tone={event.tone}>{event.label}</Badge>
          <MonoSmall>{formatDateTime(delivery.createdAt, timezone)}</MonoSmall>
        </View>
        <View style={styles.meta}>
          <StatusBadge status={delivery.status} />
          <MonoSmall>{meta}</MonoSmall>
        </View>
        {delivery.sentAt ? (
          <MonoSmall>Sent {formatDateTime(delivery.sentAt, timezone)}</MonoSmall>
        ) : null}
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
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    alignSelf: "flex-start",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    color: colors.dangerDark,
    fontSize: 12,
    lineHeight: 16,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  incidentLink: { alignSelf: "flex-start", marginTop: 2 },
  last: { borderBottomWidth: 0 },
  main: { flex: 1, gap: spacing.sm, minWidth: 0 },
  messageId: { fontSize: 12, lineHeight: 16 },
  meta: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  row: {
    alignItems: "flex-start",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  top: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
});
