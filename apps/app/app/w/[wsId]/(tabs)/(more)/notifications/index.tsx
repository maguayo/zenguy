import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { listChannels } from "@/api/channels";
import type { Channel } from "@/api/types";
import { ChannelCard } from "@/components/notifications/ChannelCard";
import { ChannelForm } from "@/components/notifications/ChannelForm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { firstParam } from "@/lib/links";
import { colors, gutter, radius, spacing } from "@/theme";
import { Button, Card, EmptyState, ErrorState, IconTile, Muted, Screen, Skeleton } from "@/ui";

const description =
  "Where Zenguy reaches you when a test fails or a monitor goes down. Default channels are preselected for new tests and monitors.";

/** iOS navigation bar height once the large title has collapsed. */
const COMPACT_HEADER_HEIGHT = 44;

function ChannelsSkeleton() {
  return (
    <View accessibilityLabel="Loading notification channels" style={styles.list}>
      {[0, 1].map((index) => (
        <Card key={index}>
          <View style={styles.skeletonHeader}>
            <Skeleton height={40} style={styles.skeletonTile} width={40} />
            <View style={styles.skeletonText}>
              <Skeleton width={160} />
              <Skeleton height={12} width={90} />
            </View>
          </View>
          <Skeleton style={styles.skeletonLine} width={220} />
        </Card>
      ))}
    </View>
  );
}

export default function NotificationsScreen() {
  const { can, current } = useWorkspace();
  const params = useLocalSearchParams<{ channel?: string }>();
  const highlightId = firstParam(params.channel);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const listOffset = useRef<number | null>(null);
  const highlightOffset = useRef<number | null>(null);
  const scrolledTo = useRef<string | undefined>(undefined);
  const [form, setForm] = useState<{ channel?: Channel; open: boolean }>({ open: false });
  const channels = useQuery({
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
    refetchInterval: 30_000,
  });
  const manage = can("channels.manage");

  const openForm = (channel?: Channel) => setForm({ channel, open: true });
  // Keep the channel while the sheet animates out so its content doesn't flash.
  const closeForm = () => setForm((state) => ({ ...state, open: false }));

  // Deep links from the Overview (`?channel=`) bring the card into view once
  // both the list and the card have been laid out.
  const scrollToHighlighted = () => {
    if (!highlightId || scrolledTo.current === highlightId) return;
    if (listOffset.current === null || highlightOffset.current === null) return;
    scrolledTo.current = highlightId;
    const y =
      listOffset.current +
      highlightOffset.current -
      (insets.top + COMPACT_HEADER_HEIGHT) -
      spacing.lg;
    if (y > 0) scrollRef.current?.scrollTo({ animated: true, y });
  };

  const onListLayout = (event: LayoutChangeEvent) => {
    listOffset.current = event.nativeEvent.layout.y;
    scrollToHighlighted();
  };

  const onHighlightLayout = (event: LayoutChangeEvent) => {
    highlightOffset.current = event.nativeEvent.layout.y;
    scrollToHighlighted();
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: manage
            ? () => (
                <Pressable
                  accessibilityLabel="Add channel"
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                  onPress={() => openForm()}
                >
                  <Feather color={colors.onInk} name="plus" size={18} />
                </Pressable>
              )
            : undefined,
          title: "Notifications",
        }}
      />
      <Screen padded={false} scroll={false}>
        <ScrollView
          ref={scrollRef}
          alwaysBounceVertical
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={channels.isRefetching && !channels.isPending}
              tintColor={colors.textMuted}
              onRefresh={() => void channels.refetch()}
            />
          }
          style={styles.flex}
        >
          <Muted>{description}</Muted>

          {channels.isPending ? (
            <ChannelsSkeleton />
          ) : channels.isError ? (
            <ErrorState onRetry={() => void channels.refetch()} />
          ) : channels.data.length === 0 ? (
            <Card elevated>
              <EmptyState
                action={
                  manage ? (
                    <Button title="Add channel" variant="accent" onPress={() => openForm()} />
                  ) : undefined
                }
                description="Create a channel once, then reuse it across tests and monitors."
                icon={<IconTile icon="mail" size={44} tone="accent" />}
                title="No notification channels yet"
              />
            </Card>
          ) : (
            <View style={styles.list} onLayout={onListLayout}>
              {channels.data.map((channel) => {
                const highlighted = channel.id === highlightId;
                return (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    highlighted={highlighted}
                    onEdit={openForm}
                    onLayout={highlighted ? onHighlightLayout : undefined}
                  />
                );
              })}
            </View>
          )}
        </ScrollView>
      </Screen>

      <ChannelForm channel={form.channel} open={form.open} onClose={closeForm} />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
  },
  flex: { flex: 1 },
  headerButton: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radius.full,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  list: { gap: spacing.md },
  pressed: { opacity: 0.7 },
  skeletonHeader: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  skeletonLine: { marginTop: spacing.lg },
  skeletonText: { flex: 1, gap: spacing.sm },
  skeletonTile: { borderRadius: radius.md },
});
