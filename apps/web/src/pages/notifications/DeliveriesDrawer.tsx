import { useInfiniteQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { listDeliveries } from "../../api/channels";
import type { Channel, Delivery } from "../../api/types";
import type { ApiPage } from "../../lib/api";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge, type BadgeProps } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { LoadMore } from "../../components/ui/LoadMore";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tooltip } from "../../components/ui/Tooltip";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { formatDateTime } from "../../lib/format";

const eventLabels: Record<
  Delivery["eventType"],
  { label: string; tone: NonNullable<BadgeProps["tone"]> }
> = {
  FAILURE: { label: "Failure", tone: "danger" },
  RECOVERY: { label: "Recovery", tone: "ok" },
  TEST: { label: "Test", tone: "neutral" },
};

export function deliveryAttempts(count: number): string {
  return `${count} ${count === 1 ? "attempt" : "attempts"}`;
}

export function deliveryEvent(eventType: Delivery["eventType"]) {
  return eventLabels[eventType];
}

export function DeliveryRow({
  delivery,
  timezone,
  workspaceId,
}: {
  delivery: Delivery;
  timezone: string;
  workspaceId: string;
}) {
  const event = deliveryEvent(delivery.eventType);

  return (
    <li className="space-y-2 border-b border-zinc-200 p-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <Badge tone={event.tone}>{event.label}</Badge>
        <time className="whitespace-nowrap text-xs text-zinc-500" dateTime={delivery.createdAt}>
          {formatDateTime(delivery.createdAt, timezone)}
        </time>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={delivery.status} />
        <span className="text-xs text-zinc-500">{deliveryAttempts(delivery.attemptCount)}</span>
        {delivery.incidentId ? (
          <Link
            aria-label="Open incident"
            className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            to={`/w/${workspaceId}/incidents/${delivery.incidentId}`}
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>
      {delivery.status === "FAILED" && delivery.errorSanitized ? (
        <Tooltip className="max-w-full" content={delivery.errorSanitized}>
          <span className="block max-w-full truncate rounded bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-700">
            {delivery.errorSanitized}
          </span>
        </Tooltip>
      ) : null}
    </li>
  );
}

function DeliveryListSkeleton() {
  return (
    <div aria-label="Loading deliveries" className="divide-y divide-zinc-200" role="status">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="space-y-3 p-4">
          <div className="flex justify-between gap-4">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-5 w-40" />
        </div>
      ))}
    </div>
  );
}

export interface DeliveriesDrawerProps {
  channel?: Channel;
  onClose: () => void;
  open: boolean;
}

export function DeliveriesDrawer({ channel, onClose, open }: DeliveriesDrawerProps) {
  const { current, timezone } = useWorkspace();
  const deliveries = useInfiniteQuery<ApiPage<Delivery>>({
    enabled: open && Boolean(channel),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listDeliveries(current.id, channel?.id ?? "", {
        cursor: pageParam as string | null,
        limit: 25,
      }),
    queryKey: [
      "ws",
      current.id,
      "channels",
      channel?.id,
      "deliveries",
      { limit: 25 },
    ],
  });
  const rows = deliveries.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Modal
      className="items-stretch justify-end p-0"
      contentClassName="p-0"
      onClose={onClose}
      open={open && Boolean(channel)}
      panelClassName="ml-auto h-full max-h-none max-w-md rounded-none sm:rounded-l-lg"
      title={`Deliveries — ${channel?.name ?? "channel"}`}
    >
      {deliveries.isPending ? (
        <DeliveryListSkeleton />
      ) : deliveries.isError ? (
        <ErrorState className="m-4" onRetry={() => void deliveries.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState className="m-4" title="No deliveries yet." />
      ) : (
        <>
          <ul>
            {rows.map((delivery) => (
              <DeliveryRow
                key={delivery.id}
                delivery={delivery}
                timezone={timezone}
                workspaceId={current.id}
              />
            ))}
          </ul>
          <div className="p-4">
            <LoadMore
              loading={deliveries.isFetchingNextPage}
              nextCursor={
                deliveries.hasNextPage
                  ? deliveries.data?.pages.at(-1)?.nextCursor ?? null
                  : null
              }
              onMore={() => void deliveries.fetchNextPage()}
            />
          </div>
        </>
      )}
    </Modal>
  );
}

export default DeliveriesDrawer;
