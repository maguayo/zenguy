import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { StyleSheet, Switch, View, type LayoutChangeEvent } from "react-native";

import { deleteChannel, listDeliveries, testChannel, updateChannel } from "@/api/channels";
import type { Channel } from "@/api/types";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { apiErrorMessage } from "@/lib/errors";
import { colors, spacing, toneSolid } from "@/theme";
import {
  ActionMenu,
  Badge,
  Caption,
  Card,
  ErrorState,
  Heading,
  Mono,
  MonoSmall,
  Muted,
  Skeleton,
  confirm,
  type ActionMenuItem,
} from "@/ui";

import {
  channelReachLabel,
  channelTarget,
  channelTypeLabels,
  lastDeliveryText,
  pausedLabel,
  testDeliveryResult,
} from "./channels";
import { ChannelTile } from "./ChannelTile";

/** Phone numbers and masked webhooks are measured values; addresses and push read as prose. */
function targetIsMono(channel: Channel): boolean {
  return channel.type !== "EMAIL" && channel.type !== "PUSH";
}

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
  const reach = channelReachLabel(channel);
  const paused = pausedLabel(channel);
  const target = channelTarget(channel);
  const tileTone = !channel.enabled ? "plain" : channel.enabled && paused ? "warn" : channel.isDefault ? "accent" : "plain";

  return (
    <View onLayout={onLayout}>
      <Card elevated={highlighted} tone={highlighted ? "accent" : undefined}>
        <View style={styles.header}>
          <ChannelTile size={44} tone={tileTone} type={channel.type} />
          <View style={styles.identity}>
            <Heading numberOfLines={1}>{channel.name}</Heading>
            <Caption>{channelTypeLabels[channel.type]}</Caption>
          </View>
          <ActionMenu
            accessibilityLabel={`Actions for ${channel.name}`}
            items={items}
            title={channel.name}
          />
        </View>

        {targetIsMono(channel) ? (
          <Mono color={colors.textBody} numberOfLines={1} style={styles.target}>
            {target}
          </Mono>
        ) : (
          <Muted numberOfLines={1} style={styles.target}>
            {target}
          </Muted>
        )}
        {reach ? <MonoSmall style={styles.detail}>{reach}</MonoSmall> : null}
        {channel.enabled && paused ? (
          <View style={styles.paused}>
            <View style={[styles.dot, { backgroundColor: toneSolid.warn }]} />
            <Caption color={colors.warn}>{paused}</Caption>
          </View>
        ) : null}

        <View style={styles.footer}>
          <View style={styles.badges}>
            {!channel.enabled ? <Badge tone="neutral">Disabled</Badge> : null}
            {channel.isDefault ? <Badge tone="accent">Default</Badge> : null}
            {channel.verifiedAt ? <Badge tone="ok">Verified</Badge> : null}
            {loadingLastDelivery ? (
              <Skeleton height={12} width={96} />
            ) : (
              <View style={styles.delivery}>
                {channel.lastDeliveryStatus ? (
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          channel.lastDeliveryStatus === "SENT"
                            ? toneSolid.ok
                            : channel.lastDeliveryStatus === "AMBIGUOUS"
                              ? toneSolid.warn
                              : toneSolid.danger,
                      },
                    ]}
                  />
                ) : null}
                <Caption>{lastDeliveryText(channel.lastDeliveryStatus, lastDelivery)}</Caption>
              </View>
            )}
          </View>
          {manage ? (
            <Switch
              accessibilityLabel={channel.enabled ? `Disable ${channel.name}` : `Enable ${channel.name}`}
              disabled={toggle.isPending}
              ios_backgroundColor={colors.borderStrong}
              trackColor={{ false: colors.borderStrong, true: colors.accent }}
              value={channel.enabled}
              onValueChange={() => void toggleChannel()}
            />
          ) : null}
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
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    minHeight: 24,
  },
  delivery: { alignItems: "center", flexDirection: "row", gap: 6 },
  deliveryError: { paddingBottom: 0, paddingTop: spacing.md },
  detail: { marginTop: spacing.xs },
  dot: { borderRadius: 3, height: 6, width: 6 },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  identity: { flex: 1, gap: 2, minWidth: 0 },
  paused: { alignItems: "center", flexDirection: "row", gap: 6, marginTop: spacing.sm },
  target: { marginTop: spacing.md },
});
