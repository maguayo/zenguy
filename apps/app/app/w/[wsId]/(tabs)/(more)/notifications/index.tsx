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
import { colors, spacing } from "@/theme";
import { Button, EmptyState, ErrorState, Muted, Screen, Spinner } from "@/ui";

const description =
  "Where Zenguy reaches you when a test fails or a monitor goes down. Default channels are preselected for new tests and monitors.";

/** iOS navigation bar height once the large title has collapsed. */
const COMPACT_HEADER_HEIGHT = 44;

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
                  style={styles.headerButton}
                  onPress={() => openForm()}
                >
                  <Feather color={colors.accent} name="plus" size={24} />
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
              tintColor={colors.zinc500}
              onRefresh={() => void channels.refetch()}
            />
          }
          style={styles.flex}
        >
          <Muted>{description}</Muted>

          {channels.isPending ? (
            <Spinner label="Loading notification channels" />
          ) : channels.isError ? (
            <ErrorState onRetry={() => void channels.refetch()} />
          ) : channels.data.length === 0 ? (
            <EmptyState
              action={
                manage ? (
                  <Button title="Add channel" variant="primary" onPress={() => openForm()} />
                ) : undefined
              }
              description="Create a channel once, then reuse it across tests and monitors."
              icon={<Feather color={colors.zinc400} name="mail" size={26} />}
              title="No notification channels yet"
            />
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
  content: { flexGrow: 1, gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  flex: { flex: 1 },
  headerButton: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  list: { gap: spacing.md },
});
