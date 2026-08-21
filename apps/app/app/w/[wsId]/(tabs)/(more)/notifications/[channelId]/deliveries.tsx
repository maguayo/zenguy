import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";

import { listChannels, listDeliveries } from "@/api/channels";
import type { Delivery } from "@/api/types";
import { channelTarget, channelTypeLabels } from "@/components/notifications/channels";
import { DeliveryRow } from "@/components/notifications/DeliveryRow";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { ApiPage } from "@/lib/api";
import { firstParam } from "@/lib/links";
import { spacing } from "@/theme";
import { Caption, Card, EmptyState, ErrorState, Heading, LoadMore, Screen, Spinner } from "@/ui";

export default function ChannelDeliveriesScreen() {
  const { current, timezone } = useWorkspace();
  const params = useLocalSearchParams<{ channelId: string }>();
  const channelId = firstParam(params.channelId) ?? "";
  const channels = useQuery({
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
  });
  const channel = channels.data?.find((candidate) => candidate.id === channelId);
  const deliveries = useInfiniteQuery<ApiPage<Delivery>>({
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listDeliveries(current.id, channelId, { cursor: pageParam as string | null, limit: 25 }),
    queryKey: ["ws", current.id, "channels", channelId, "deliveries", { limit: 25 }],
  });
  const rows = deliveries.data?.pages.flatMap((page) => page.items) ?? [];
  const nextCursor = deliveries.hasNextPage
    ? (deliveries.data?.pages.at(-1)?.nextCursor ?? null)
    : null;

  return (
    <>
      <Stack.Screen options={{ title: "Deliveries" }} />
      <Screen
        refreshing={
          deliveries.isRefetching && !deliveries.isPending && !deliveries.isFetchingNextPage
        }
        onRefresh={() => void deliveries.refetch()}
      >
        <View style={styles.stack}>
          {channel ? (
            <View style={styles.channel}>
              <Heading>{channel.name}</Heading>
              <Caption numberOfLines={1}>
                {channelTypeLabels[channel.type]} · {channelTarget(channel)}
              </Caption>
            </View>
          ) : null}

          {deliveries.isPending ? (
            <Spinner label="Loading deliveries" />
          ) : deliveries.isError ? (
            <ErrorState onRetry={() => void deliveries.refetch()} />
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState title="No deliveries yet." />
            </Card>
          ) : (
            <Card padding="none">
              {rows.map((delivery, index) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  last={index === rows.length - 1}
                  timezone={timezone}
                  workspaceId={current.id}
                />
              ))}
            </Card>
          )}

          <LoadMore
            loading={deliveries.isFetchingNextPage}
            nextCursor={nextCursor}
            onMore={() => void deliveries.fetchNextPage()}
          />
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  channel: { gap: 2 },
  stack: { gap: spacing.lg },
});
