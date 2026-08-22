import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { deleteChannel, listDeliveries, testChannel, updateChannel } from "@/api/channels";
import type { Channel } from "@/api/types";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { apiErrorMessage } from "@/lib/errors";
import { colors, radius, spacing } from "@/theme";
import {
  ActionMenu,
  Badge,
  Body,
  Caption,
  Card,
  ErrorState,
  Muted,
  Skeleton,
  confirm,
  type ActionMenuItem,
} from "@/ui";

import {
  channelIcons,
  channelPriceLabel,
  channelReachLabel,
  channelTarget,
  channelTypeLabels,
  lastDeliveryText,
  pausedLabel,
  testDeliveryResult,
} from "./channels";

export function ChannelCard({
  channel,
  highlighted = false,
  onEdit,
  onLayout,
}: {
  channel: Channel;
  /** Emphasised when the screen was opened for this channel (`?channel=`). */
  highlighted?: boolean;
  onEdit: (channel: Channel) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
  const manage = can("channels.manage");

  const deliveries = useQuery({
    enabled: Boolean(channel.lastDeliveryStatus),
    queryFn: () => listDeliveries(current.id, channel.id, { limit: 1 }),
    queryKey: ["ws", current.id, "channels", channel.id, "deliveries", { limit: 1 }],
  });
  const test = useMutation({ mutationFn: () => testChannel(current.id, channel.id) });
  const remove = useMutation({ mutationFn: () => deleteChannel(current.id, channel.id) });
  const toggle = useMutation({
    mutationFn: () => updateChannel(current.id, channel.id, { enabled: !channel.enabled }),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ws", current.id, "channels"] }),
      queryClient.invalidateQueries({
        queryKey: ["ws", current.id, "channels", channel.id, "deliveries"],
      }),
    ]);
  };

  const sendTest = async () => {
    const confirmed = await confirm({
      confirmLabel: "Send test",
      message: "This sends a real notification to this channel.",
      title: "Send a test notification?",
    });
    if (!confirmed) return;
    try {
      const delivery = await test.mutateAsync();
      const result = testDeliveryResult(delivery);
      if (result.tone === "success") toast.success(result.message);
      else toast.error(result.message);
      await refresh();
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const toggleChannel = async () => {
    try {
      await toggle.mutateAsync();
      toast.success(channel.enabled ? "Channel disabled" : "Channel enabled");
      await refresh();
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const removeChannel = async () => {
    const confirmed = await confirm({
      confirmLabel: "Delete",
      destructive: true,
      message: "It will be removed from every test and monitor that uses it.",
      title: `Delete "${channel.name}"?`,
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync();
      toast.success("Channel deleted");
      await refresh();
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const items: ActionMenuItem[] = [
    ...(manage
      ? [{ disabled: test.isPending, label: "Send test", onSelect: () => void sendTest() }]
      : []),
    {
      label: "View deliveries",
      onSelect: () =>
        router.push(`/w/${current.id}/notifications/${channel.id}/deliveries` as Href),
    },
    ...(manage && channel.type !== "PUSH" ? [{ label: "Edit", onSelect: () => onEdit(channel) }] : []),
    ...(manage
      ? [
          {
            disabled: toggle.isPending,
            label: channel.enabled ? "Disable" : "Enable",
            onSelect: () => void toggleChannel(),
          },
          {
            destructive: true,
            disabled: remove.isPending,
            label: "Delete",
            onSelect: () => void removeChannel(),
          },
        ]
      : []),
  ];

  const lastDelivery = deliveries.data?.items[0];
  const loadingLastDelivery = Boolean(channel.lastDeliveryStatus) && deliveries.isPending;
  const price = channelPriceLabel(channel);
  const reach = channelReachLabel(channel);
  const paused = pausedLabel(channel);

  return (
    <View onLayout={onLayout}>
      <Card style={highlighted ? styles.highlighted : undefined}>
        <View style={styles.header}>
          <View style={styles.icon}>
            <Ionicons color={colors.zinc700} name={channelIcons[channel.type]} size={20} />
          </View>
          <View style={styles.identity}>
            <Body numberOfLines={1} style={styles.name}>
              {channel.name}
            </Body>
            <Caption>{channelTypeLabels[channel.type]}</Caption>
          </View>
          <ActionMenu
            accessibilityLabel={`Actions for ${channel.name}`}
            items={items}
            title={channel.name}
          />
        </View>

        <Muted numberOfLines={1} style={styles.target}>
          {channelTarget(channel)}
        </Muted>
        {price ? <Caption style={styles.price}>{price}</Caption> : null}
        {reach ? <Caption style={styles.price}>{reach}</Caption> : null}

        <View style={styles.badges}>
          {!channel.enabled ? <Badge tone="neutral">Disabled</Badge> : null}
          {channel.isDefault ? <Badge tone="accent">Default</Badge> : null}
          {channel.enabled && paused ? <Badge tone="warn">{paused}</Badge> : null}
          {channel.verifiedAt ? <Badge tone="ok">Verified</Badge> : null}
          {loadingLastDelivery ? (
            <Skeleton height={12} width={96} />
          ) : (
            <View style={styles.delivery}>
              {channel.lastDeliveryStatus ? (
                <View
                  style={[
                    styles.deliveryDot,
                    {
                      backgroundColor:
                        channel.lastDeliveryStatus === "SENT" ? colors.ok : colors.danger,
                    },
                  ]}
                />
              ) : null}
              <Caption>{lastDeliveryText(channel.lastDeliveryStatus, lastDelivery)}</Caption>
            </View>
          )}
        </View>

        {deliveries.isError ? (
          <ErrorState
            message="The latest delivery couldn't be loaded."
            style={styles.deliveryError}
            onRetry={() => void deliveries.refetch()}
          />
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  badges: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
    minHeight: 24,
  },
  delivery: { alignItems: "center", flexDirection: "row", gap: 6 },
  deliveryDot: { borderRadius: 3, height: 6, width: 6 },
  deliveryError: { paddingBottom: 0, paddingTop: spacing.md },
  header: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md },
  highlighted: { borderColor: colors.accent, borderWidth: 1 },
  icon: {
    alignItems: "center",
    backgroundColor: colors.zinc100,
    borderRadius: radius.md,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  identity: { flex: 1, gap: 2, minWidth: 0, paddingTop: 2 },
  name: { fontWeight: "600" },
  price: { marginTop: spacing.xs },
  target: { marginTop: spacing.md },
});
