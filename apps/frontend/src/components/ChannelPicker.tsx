import { Link } from "react-router-dom";

import type { Channel } from "../api/types";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";
import { Checkbox } from "./ui/Checkbox";
import { ErrorState } from "./ui/ErrorState";
import { Spinner } from "./ui/Spinner";
import { formatEuros } from "../lib/format";

/** Channels preselected for a new test or monitor. */
export function defaultChannelIds(channels: Channel[]): string[] {
  return channels
    .filter((channel) => channel.enabled && channel.isDefault)
    .map((channel) => channel.id);
}

export function toggleChannelId(value: string[], channelId: string): string[] {
  return value.includes(channelId)
    ? value.filter((candidate) => candidate !== channelId)
    : [...value, channelId];
}

export function ChannelPicker({
  channels,
  error,
  loading,
  manageHref,
  onChange,
  onRetry,
  value,
}: {
  channels: Channel[];
  error: boolean;
  loading: boolean;
  manageHref: string;
  onChange: (value: string[]) => void;
  onRetry: () => void;
  value: string[];
}) {
  return (
    <Card
      actions={
        <Link className="text-xs font-medium text-accent-700 hover:underline" to={manageHref}>
          Manage channels
        </Link>
      }
      title="Notifications"
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner label="Loading notification channels" /> Loading channels…
        </div>
      ) : error ? (
        <ErrorState onRetry={onRetry} />
      ) : channels.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No channels yet — create one under Alerts.
        </p>
      ) : (
        <fieldset>
          <legend className="sr-only">Notification channels</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {channels.map((channel) => (
              <label
                key={channel.id}
                className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2.5 text-sm text-zinc-700"
              >
                <Checkbox
                  checked={value.includes(channel.id)}
                  onChange={() => onChange(toggleChannelId(value, channel.id))}
                />
                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                {channel.price ? (
                  <span className="whitespace-nowrap text-xs text-zinc-500">
                    {formatEuros(channel.price.cents)}
                  </span>
                ) : null}
                {channel.enabled && channel.paused ? <Badge tone="warn">Paused</Badge> : null}
                <Badge>{channel.type}</Badge>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </Card>
  );
}
