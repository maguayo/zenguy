import type { ActivityFeedEvent, ActivityFeedResponse } from "../../shared/types";
import { groupActivityTypes, labelForType, propertiesSummary, shortId } from "../lib/activity";
import { formatDateTime, relativeSeconds } from "../lib/format";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";

const EM_DASH = "—";

/** The catalog never changes at runtime; shape it once for every render. */
const TYPE_GROUPS = groupActivityTypes();

function TypeFilter({
  onChange,
  value,
}: {
  onChange: (type: string | null) => void;
  value: string | null;
}) {
  return (
    <select
      aria-label="Filter activity by event type"
      className="h-9 rounded-md border border-zinc-300 bg-white px-2 font-medium text-zinc-700"
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      value={value ?? ""}
    >
      <option value="">All events</option>
      {TYPE_GROUPS.map((group) => (
        <optgroup key={group.subject} label={group.subject}>
          {group.options.map((option) => (
            <option key={option.type} value={option.type}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** The actor, or the fact that nobody asked for it: schedulers and webhooks. */
function Actor({ actor }: { actor: ActivityFeedEvent["actor"] }) {
  if (actor === null) return <span className="text-zinc-500">system</span>;
  return (
    <>
      <span>{actor.name || "No name"}</span>
      <span className="block font-mono text-xs text-zinc-500">{actor.email}</span>
    </>
  );
}

function Resource({ event }: { event: ActivityFeedEvent }) {
  if (event.resourceType === null && event.resourceId === null) {
    return <span className="text-zinc-500">{EM_DASH}</span>;
  }
  return (
    <>
      <span className="text-zinc-500">{event.resourceType ?? "unknown"}</span>
      {event.resourceId === null ? null : (
        <span className="block font-mono text-xs text-zinc-500" title={event.resourceId}>
          {shortId(event.resourceId)}
        </span>
      )}
    </>
  );
}

function EventRow({ event, now }: { event: ActivityFeedEvent; now: number }) {
  const summary = propertiesSummary(event.properties);
  return (
    <tr>
      <td className="py-2 whitespace-nowrap text-zinc-500">
        <span title={formatDateTime(event.occurredAt)}>
          {relativeSeconds(event.occurredAt, now)}
        </span>
      </td>
      <td className="py-2">
        <span className="font-medium">{labelForType(event.type)}</span>
        {/* The payload is the point in an ops panel, so it is shown raw — one
            line, truncated, never wrapped into a second row. */}
        {summary === null ? null : <span className="block text-xs text-zinc-500">{summary}</span>}
      </td>
      <td className="py-2">
        <Actor actor={event.actor} />
      </td>
      <td className="py-2 text-zinc-500">{event.workspace?.name ?? EM_DASH}</td>
      <td className="py-2">
        <StatusBadge label={event.source} />
      </td>
      <td className="py-2">
        <Resource event={event} />
      </td>
    </tr>
  );
}

function emptyMessage(type: string | null): string {
  return type === null ? "No events yet" : `No ${labelForType(type)} events yet`;
}

export interface ActivityFeedProps {
  feed: ActivityFeedResponse;
  now: number;
  onTypeChange: (type: string | null) => void;
  /** The event type in force, or null for every type. */
  type: string | null;
}

/**
 * Everything the platform recorded, newest first: who did what, from which
 * client, in which workspace. The filter is part of the card header because it
 * decides what the rows below mean.
 */
export function ActivityFeed({ feed, now, onTypeChange, type }: ActivityFeedProps) {
  return (
    <Card
      aside={
        <span className="flex flex-wrap items-center gap-3">
          Latest 50 events · refreshes every 30 s
          <TypeFilter onChange={onTypeChange} value={type} />
        </span>
      }
      title="Activity"
    >
      {"unavailable" in feed ? (
        <p className="text-zinc-500">
          Pending production migration (activity events) — the feed fills in once 0038 reaches the
          production database.
        </p>
      ) : feed.events.length === 0 ? (
        <p className="text-zinc-500">{emptyMessage(type)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium">Event</th>
                <th className="pb-2 font-medium">Who</th>
                <th className="pb-2 font-medium">Where</th>
                <th className="pb-2 font-medium">Source</th>
                <th className="pb-2 font-medium">Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {feed.events.map((event) => (
                <EventRow event={event} key={event.id} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
