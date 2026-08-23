import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { listChannels } from "@/api/channels";
import type { Channel } from "@/api/types";
import { channelTypeLabels } from "@/components/notifications/channels";
import { ChannelTile } from "@/components/notifications/ChannelTile";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { colors, palette, radius, spacing } from "@/theme";
import { Body, Caption, Card, ErrorState, Label, Muted, Spinner } from "@/ui";

/** Channels flagged as workspace defaults (enabled only), preselected on new tests/monitors. */
export function defaultChannelIds(channels: Channel[]): string[] {
  return channels.filter((channel) => channel.enabled && channel.isDefault === true).map((channel) => channel.id);
}

export function toggleChannelId(value: string[], channelId: string): string[] {
  return value.includes(channelId)
    ? value.filter((candidate) => candidate !== channelId)
    : [...value, channelId];
}

/**
 * Multi-select of the workspace's notification channels, used by the browser
 * test and uptime monitor forms. Loads the channels itself.
 */
export function ChannelPicker({
  onChange,
  value,
}: {
  onChange: (value: string[]) => void;
  value: string[];
}) {
  const router = useRouter();
  const { current } = useWorkspace();
  const channels = useQuery({
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
  });

  return (
    <Card
      action={
        <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push(`/w/${current.id}/notifications`)}>
          <Label color={colors.accentDark}>Manage channels</Label>
        </Pressable>
      }
      eyebrow="Notifications"
    >
      {channels.isPending ? (
        <Spinner label="Loading notification channels" />
      ) : channels.isError ? (
        <ErrorState onRetry={() => void channels.refetch()} />
      ) : channels.data.length === 0 ? (
        <Muted>No channels yet — create one under Notifications.</Muted>
      ) : (
        <View style={styles.list}>
          {channels.data.map((channel: Channel) => {
            const checked = value.includes(channel.id);
            return (
              <Pressable
                key={channel.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                style={({ pressed }) => [styles.row, checked && styles.rowChecked, pressed && styles.pressed]}
                onPress={() => onChange(toggleChannelId(value, channel.id))}
              >
                <ChannelTile size={32} tone={checked ? "accent" : "plain"} type={channel.type} />
                <View style={styles.text}>
                  <Body numberOfLines={1} style={styles.name}>
                    {channel.name}
                  </Body>
                  <Caption>{channelTypeLabels[channel.type]}</Caption>
                </View>
                <View style={[styles.box, checked && styles.boxChecked]}>
                  {checked ? <Feather color={colors.white} name="check" size={14} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  boxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  list: { gap: spacing.sm },
  name: { fontWeight: "500" },
  pressed: { opacity: 0.8 },
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowChecked: { backgroundColor: palette.violetBg, borderColor: palette.violetLine },
  text: { flex: 1, gap: 1, minWidth: 0 },
});
