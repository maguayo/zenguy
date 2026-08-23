import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Gamepad2,
  Hash,
  History,
  Mail,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Power,
  Send,
  Smartphone,
  Star,
  StarOff,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  deleteChannel,
  listChannels,
  listDeliveries,
  testChannel,
  updateChannel,
} from "../../api/channels";
import type { Channel, ChannelType, Delivery } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dropdown, type DropdownItem } from "../../components/ui/Dropdown";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { IconButton } from "../../components/ui/IconButton";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { apiErrorMessage } from "../../lib/errors";
import { formatEuros, formatRelative } from "../../lib/format";
import { alertsQueryKey, getAlertsOverview } from "../../api/alerts";
import { AlertsTabs } from "../alerts/AlertsTabs";
import { ChannelFormModal } from "./ChannelFormModal";
import { DeliveriesDrawer } from "./DeliveriesDrawer";

const channelIcons: Record<ChannelType, LucideIcon> = {
  CALL: Phone,
  DISCORD: Gamepad2,
  EMAIL: Mail,
  PUSH: Smartphone,
  SLACK: Hash,
  SMS: MessageSquare,
  WHATSAPP: MessageCircle,
};

const channelTypeLabels: Record<ChannelType, string> = {
  CALL: "Phone call",
  DISCORD: "Discord",
  EMAIL: "Email",
  PUSH: "Mobile push",
  SLACK: "Slack",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
};

export function channelTarget(channel: Channel): string {
  switch (channel.type) {
    case "EMAIL":
      return channel.configPreview.emails?.join(", ") || "—";
    case "SMS":
    case "WHATSAPP":
    case "CALL":
      return channel.configPreview.phoneNumber ?? "—";
    case "SLACK":
    case "DISCORD":
      return channel.configPreview.webhookUrlMasked ?? "—";
    case "PUSH":
      return "Everyone in this workspace who uses the Zenguy app";
  }
}

export function reachLabel(channel: Channel): string | null {
  if (channel.type !== "PUSH") return null;
  if (!channel.reach || channel.reach.devices === 0) {
    return "No devices yet · install the app and allow notifications";
  }
  const devices = `${channel.reach.devices} ${channel.reach.devices === 1 ? "device" : "devices"}`;
  const members = `${channel.reach.members} ${channel.reach.members === 1 ? "member" : "members"}`;
  return `${devices} · ${members} · free`;
}

export function channelPriceLabel(channel: Channel): string | null {
  if (!channel.price) return null;
  const unit = channel.type === "CALL" ? "call" : "alert";
  return `${channel.price.destination} · ${formatEuros(channel.price.cents)} per ${unit}`;
}

export function pausedLabel(channel: Channel): string | null {
  if (!channel.paused) return null;
  return channel.paused.reason === "PAID_OFF"
    ? "Paused · SMS & calls off"
    : "Paused · no credit";
}

export function canChangeChannelDefault(channel: Pick<Channel, "type">): boolean {
  return channel.type !== "PUSH";
}

export function lastDeliveryText(
  status: Channel["lastDeliveryStatus"],
  delivery?: Delivery,
): string {
  if (!status) return "Never used";
  const label = status === "SENT" ? "Delivered" : "Failed";
  return delivery ? `${label} ${formatRelative(delivery.createdAt)}` : label;
}

export function testDeliveryResult(delivery: Delivery): {
  message: string;
  tone: "error" | "success";
} {
  return delivery.status === "SENT"
    ? { message: "Test sent", tone: "success" }
    : {
        message: `Test failed: ${delivery.errorSanitized ?? "Unknown error"}`,
        tone: "error",
      };
}

export function openChannelPanel(
  current: URLSearchParams,
  panel: "channel" | "deliveries",
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete(panel === "channel" ? "deliveries" : "channel");
  next.set(panel, value);
  return next;
}

export function closeChannelPanel(
  current: URLSearchParams,
  panel: "channel" | "deliveries",
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete(panel);
  return next;
}

export function ChannelSummary({
  channel,
  lastDelivery,
  loadingLastDelivery = false,
}: {
  channel: Channel;
  lastDelivery?: Delivery;
  loadingLastDelivery?: boolean;
}) {
  const Icon = channelIcons[channel.type];
  const deliveryLabel = lastDeliveryText(channel.lastDeliveryStatus, lastDelivery);
  const deliveryTone = channel.lastDeliveryStatus === "SENT" ? "bg-ok-600" : "bg-danger-600";

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-700">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-zinc-900">{channel.name}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{channelTypeLabels[channel.type]}</p>
        </div>
      </div>

      <p className="mt-4 truncate text-sm text-zinc-600" title={channelTarget(channel)}>
        {channelTarget(channel)}
      </p>
      {channelPriceLabel(channel) ? (
        <p className="mt-1 text-xs text-zinc-500">{channelPriceLabel(channel)}</p>
      ) : null}
      {reachLabel(channel) ? (
        <p className="mt-1 text-xs text-zinc-500">{reachLabel(channel)}</p>
      ) : null}

      <div className="mt-4 flex min-h-6 flex-wrap items-center gap-2">
        {!channel.enabled ? <Badge tone="neutral">Disabled</Badge> : null}
        {channel.isDefault ? <Badge tone="accent">Default</Badge> : null}
        {channel.enabled && pausedLabel(channel) ? (
          <Badge tone="warn">{pausedLabel(channel)}</Badge>
        ) : null}
        {channel.verifiedAt ? <Badge tone="ok">Verified</Badge> : null}
        {loadingLastDelivery ? (
          <Skeleton aria-label="Loading latest delivery" className="h-3 w-24" />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
            {channel.lastDeliveryStatus ? (
              <span aria-hidden="true" className={`size-1.5 rounded-full ${deliveryTone}`} />
            ) : null}
            {deliveryLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function ChannelActions({ channel }: { channel: Channel }) {
  const { can, current } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const [testOpen, setTestOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const test = useMutation({ mutationFn: () => testChannel(current.id, channel.id) });
  const remove = useMutation({ mutationFn: () => deleteChannel(current.id, channel.id) });
  const toggle = useMutation({
    mutationFn: () => updateChannel(current.id, channel.id, { enabled: !channel.enabled }),
  });
  const setDefault = useMutation({
    mutationFn: () =>
      updateChannel(current.id, channel.id, { isDefault: !channel.isDefault }),
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

  const toggleDefault = async () => {
    try {
      await setDefault.mutateAsync();
      toast.success(
        channel.isDefault
          ? "Removed from defaults"
          : "New tests and monitors will preselect this channel",
      );
      await refresh();
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const removeChannel = async () => {
    try {
      await remove.mutateAsync();
      toast.success("Channel deleted");
      await refresh();
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const items: DropdownItem[] = [
    ...(can("channels.manage")
      ? [
          {
            disabled: test.isPending,
            icon: <Send className="size-4" />,
            label: "Send test",
            onSelect: () => setTestOpen(true),
          },
        ]
      : []),
    {
      icon: <History className="size-4" />,
      label: "View deliveries",
      onSelect: () =>
        setSearchParams(openChannelPanel(searchParams, "deliveries", channel.id)),
    },
    ...(can("channels.manage")
      ? [
          {
            icon: <Pencil className="size-4" />,
            label: "Edit",
            onSelect: () =>
              setSearchParams(openChannelPanel(searchParams, "channel", channel.id)),
          },
          ...(canChangeChannelDefault(channel)
            ? [
                {
                  disabled: setDefault.isPending,
                  icon: channel.isDefault ? (
                    <StarOff className="size-4" />
                  ) : (
                    <Star className="size-4" />
                  ),
                  label: channel.isDefault ? "Remove from defaults" : "Use as default",
                  onSelect: () => void toggleDefault(),
                },
              ]
            : []),
          {
            disabled: toggle.isPending,
            icon: <Power className="size-4" />,
            label: channel.enabled ? "Disable" : "Enable",
            onSelect: () => void toggleChannel(),
          },
          {
            icon: <Trash2 className="size-4" />,
            label: "Delete",
            onSelect: () => setDeleteOpen(true),
            separatorBefore: true,
            tone: "danger" as const,
          },
        ]
      : []),
  ];

  return (
    <>
      <Dropdown
        items={items}
        trigger={
          <IconButton aria-label={`Actions for ${channel.name}`}>
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </IconButton>
        }
      />
      <ConfirmDialog
        body="This sends a real notification to this channel."
        confirmLabel="Send test"
        onClose={() => setTestOpen(false)}
        onConfirm={sendTest}
        open={testOpen}
        title="Send a test notification?"
      />
      <ConfirmDialog
        body="It will be removed from every test and monitor that uses it."
        confirmLabel="Delete"
        onClose={() => setDeleteOpen(false)}
        onConfirm={removeChannel}
        open={deleteOpen}
        title={`Delete "${channel.name}"?`}
        tone="danger"
      />
    </>
  );
}

function ChannelCard({ channel }: { channel: Channel }) {
  const { current } = useWorkspace();
  const deliveries = useQuery({
    enabled: Boolean(channel.lastDeliveryStatus),
    queryFn: () => listDeliveries(current.id, channel.id, { limit: 1 }),
    queryKey: ["ws", current.id, "channels", channel.id, "deliveries", { limit: 1 }],
  });

  return (
    <Card className="min-h-44">
      <div className="flex items-start gap-3">
        <ChannelSummary
          channel={channel}
          lastDelivery={deliveries.data?.items[0]}
          loadingLastDelivery={Boolean(channel.lastDeliveryStatus) && deliveries.isPending}
        />
        <ChannelActions channel={channel} />
      </div>
      {deliveries.isError ? (
        <ErrorState
          className="mt-3"
          message="The latest delivery couldn't be loaded."
          onRetry={() => void deliveries.refetch()}
        />
      ) : null}
    </Card>
  );
}

function ChannelGridSkeleton(): ReactNode {
  return (
    <div aria-label="Loading notification channels" className="grid gap-4 md:grid-cols-2" role="status">
      {Array.from({ length: 4 }, (_, index) => (
        <Card key={index} className="min-h-44">
          <div className="flex gap-3">
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="mt-5 h-4 w-3/4" />
          <Skeleton className="mt-5 h-5 w-28 rounded-full" />
        </Card>
      ))}
    </div>
  );
}

export default function ChannelsPage() {
  const { can, current } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const channels = useQuery({
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
    refetchInterval: 30_000,
  });
  const overview = useQuery({
    queryFn: () => getAlertsOverview(current.id),
    queryKey: alertsQueryKey(current.id),
  });
  const addChannel = () =>
    setSearchParams(openChannelPanel(searchParams, "channel", "new"));
  const channelParam = searchParams.get("channel");
  const editingChannel =
    channelParam && channelParam !== "new"
      ? channels.data?.find((channel) => channel.id === channelParam)
      : undefined;
  const formOpen =
    can("channels.manage") &&
    (channelParam === "new" || Boolean(editingChannel));
  const closeForm = () =>
    setSearchParams(closeChannelPanel(searchParams, "channel"), { replace: true });
  const deliveriesParam = searchParams.get("deliveries");
  const deliveriesChannel = deliveriesParam
    ? channels.data?.find((channel) => channel.id === deliveriesParam)
    : undefined;
  const closeDeliveries = () =>
    setSearchParams(closeChannelPanel(searchParams, "deliveries"), { replace: true });

  return (
    <div className="space-y-6">
      <AlertsTabs
        actions={
          can("channels.manage") ? (
            <Button onClick={addChannel} variant="primary">
              <Plus aria-hidden="true" className="size-4" />
              Add channel
            </Button>
          ) : undefined
        }
        active="channels"
        description="Where Zenguy reaches you when a test fails or a monitor goes down. Default channels are preselected for new tests and monitors."
      />

      {channels.isPending ? (
        <ChannelGridSkeleton />
      ) : channels.isError ? (
        <ErrorState onRetry={() => void channels.refetch()} />
      ) : channels.data.length === 0 ? (
        <EmptyState
          action={
            can("channels.manage") ? (
              <Button onClick={addChannel} variant="primary">
                Add channel
              </Button>
            ) : undefined
          }
          description="Create a channel once, then reuse it across tests and monitors."
          icon={<Mail aria-hidden="true" className="size-7" />}
          title="No notification channels yet"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {channels.data.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      )}

      <ChannelFormModal
        channel={editingChannel}
        onClose={closeForm}
        open={formOpen}
        paidChannelsEnabled={overview.data?.settings.paidChannelsEnabled}
      />
      <DeliveriesDrawer
        channel={deliveriesChannel}
        onClose={closeDeliveries}
        open={Boolean(deliveriesChannel)}
      />
    </div>
  );
}
