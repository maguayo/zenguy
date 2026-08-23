import { useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import type { IncidentDetail, IncidentEvent } from "@/api/types";
import { formatDateTime, formatRelative } from "@/lib/format";
import { colors, radius, spacing, toneColors } from "@/theme";
import { Badge, Body, IconTile, Mono, MonoSmall, Muted } from "@/ui";

import {
  eventPresentation,
  sortedIncidentEvents,
  timelineChips,
  type TimelineChip,
} from "./incident-timeline";

function Chip({ chip, onPress }: { chip: TimelineChip; onPress?: () => void }) {
  if (!onPress) return <Badge tone={chip.tone}>{chip.label}</Badge>;
  const palette = toneColors[chip.tone];
  return (
    <Pressable
      accessibilityRole="link"
      hitSlop={4}
      style={({ pressed }) => [
        styles.linkChip,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Mono color={palette.fg} style={styles.linkChipText}>
        {chip.label}
      </Mono>
    </Pressable>
  );
}

/**
 * Chronological incident events on a sand rail: a tinted dot per event type,
 * the message in Geist, the time in mono, evidence as chips.
 */
export function IncidentTimeline({
  events,
  incident,
  timezone,
  workspaceId,
}: {
  events: IncidentEvent[];
  incident: Pick<IncidentDetail, "resourceId" | "resourceType">;
  timezone: string;
  workspaceId: string;
}) {
  const router = useRouter();
  if (events.length === 0) return <Muted>No events recorded.</Muted>;

  const ordered = sortedIncidentEvents(events);
  return (
    <View accessibilityRole="list">
      {ordered.map((event, index) => {
        const presentation = eventPresentation[event.type];
        const chips = timelineChips(event, incident, workspaceId);
        const last = index === ordered.length - 1;
        return (
          <View key={event.id} style={[styles.item, last && styles.lastItem]}>
            <View style={styles.rail}>
              <IconTile icon={presentation.icon} round size={28} tone={presentation.tone} />
              {last ? null : <View style={styles.line} />}
            </View>
            <View style={styles.content}>
              <Body style={styles.message}>{event.message}</Body>
              <MonoSmall style={styles.time}>
                {formatDateTime(event.createdAt, timezone)} · {formatRelative(event.createdAt)}
              </MonoSmall>
              {chips.length > 0 ? (
                <View style={styles.chips}>
                  {chips.map((chip) => {
                    const href = chip.href;
                    return (
                      <Chip
                        key={chip.key}
                        chip={chip}
                        onPress={href ? () => router.push(href as Href) : undefined}
                      />
                    );
                  })}
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  content: { flex: 1, minWidth: 0, paddingTop: 3 },
  item: { flexDirection: "row", gap: spacing.md, paddingBottom: spacing.lg },
  lastItem: { paddingBottom: 0 },
  line: { backgroundColor: colors.borderStrong, flex: 1, marginTop: spacing.xs, width: 2, borderRadius: 1 },
  linkChip: {
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  linkChipText: { fontSize: 12, lineHeight: 16 },
  message: { fontWeight: "500" },
  pressed: { opacity: 0.7 },
  rail: { alignItems: "center", width: 28 },
  time: { marginTop: 3 },
});
