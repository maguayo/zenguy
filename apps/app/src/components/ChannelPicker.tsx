import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { listChannels } from "@/api/channels";
import type { Channel } from "@/api/types";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { colors, radius, spacing } from "@/theme";
import { Badge, Body, Card, ErrorState, Label, Muted, Spinner } from "@/ui";

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
        <Pressable accessibilityRole="link" onPress={() => router.push(`/w/${current.id}/notifications`)}>
          <Label color={colors.accentDark}>Manage channels</Label>
        </Pressable>
      }
      title="Notifications"
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
                <View style={[styles.box, checked && styles.boxChecked]}>
                  {checked ? <Feather color={colors.white} name="check" size={14} /> : null}
                </View>
                <Body numberOfLines={1} style={styles.name}>
                  {channel.name}
                </Body>
                <Badge>{channel.type}</Badge>
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
    borderColor: colors.zinc300,
    borderRadius: 5,
    borderWidth: 1.5,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  boxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  list: { gap: spacing.sm },
  name: { flex: 1 },
  pressed: { backgroundColor: colors.zinc50 },
  row: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowChecked: { borderColor: colors.accent },
});
