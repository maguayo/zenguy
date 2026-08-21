import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { getIncident } from "../../api/incidents";
import type { IncidentDelivery } from "../../api/types";
import { IncidentTimeline } from "../../components/IncidentTimeline";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Spinner";
import { Table, type TableColumn } from "../../components/ui/Table";
import { Tooltip } from "../../components/ui/Tooltip";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { itemQueryErrorMessage } from "../../lib/errors";
import { formatDateTime, formatDuration, formatEuros } from "../../lib/format";

export const emptyDeliveriesCopy =
  "No notifications were configured when this incident opened.";

export function incidentDeliveryColumns(timezone: string): TableColumn<IncidentDelivery>[] {
  return [
    {
      header: "Channel",
      key: "channel",
      render: (delivery) => (
        <div>
          <p className="font-medium text-zinc-900">{delivery.channelName}</p>
          {delivery.channelType ? <p className="mt-0.5 text-xs text-zinc-500">{delivery.channelType}</p> : null}
        </div>
      ),
    },
    {
      header: "Event",
      key: "event",
      render: (delivery) => delivery.eventType === "FAILURE" ? "Failure" : "Recovery",
    },
    {
      header: "Status",
      key: "status",
      render: (delivery) => {
        const badge = (
          <Badge tone={delivery.status === "SENT" ? "ok" : delivery.status === "FAILED" ? "danger" : "neutral"}>
            {delivery.status === "SENT" ? "Sent" : delivery.status === "FAILED" ? "Failed" : "Pending"}
          </Badge>
        );
        return delivery.status === "FAILED" && delivery.errorSanitized ? (
          <Tooltip content={delivery.errorSanitized}>{badge}</Tooltip>
        ) : badge;
      },
    },
    { header: "Attempts", key: "attempts", render: (delivery) => delivery.attemptCount },
    {
      header: "Cost",
      key: "cost",
      render: (delivery) =>
        delivery.costCents === null ? (
          "—"
        ) : (
          <span className="whitespace-nowrap">{formatEuros(delivery.costCents)}</span>
        ),
    },
    {
      header: "Time",
      key: "time",
      render: (delivery) => (
        <span className="whitespace-nowrap">
          {formatDateTime(delivery.sentAt ?? delivery.createdAt, timezone)}
        </span>
      ),
    },
  ];
}

export default function IncidentDetailPage() {
  const { incidentId = "" } = useParams();
  const { current, timezone } = useWorkspace();
  const incident = useQuery({
    queryFn: () => getIncident(current.id, incidentId),
    queryKey: ["ws", current.id, "incidents", incidentId],
    refetchInterval: (query) => query.state.data?.status === "OPEN" ? 30_000 : false,
  });

  if (incident.isPending) {
    return <div className="grid min-h-64 place-items-center"><Spinner label="Loading incident" size={6} /></div>;
  }
  if (incident.isError) {
    return (
      <ErrorState
        message={itemQueryErrorMessage(incident.error)}
        onRetry={() => void incident.refetch()}
      />
    );
  }

  const data = incident.data;
  const resourceLabel = data.resourceType === "BROWSER_TEST" ? "browser test" : "monitor";
  const resourceHref = data.resourceType === "BROWSER_TEST"
    ? `/w/${current.id}/tests/${data.resourceId}`
    : `/w/${current.id}/uptime/${data.resourceId}`;
  const meta = [
    `Opened ${formatDateTime(data.openedAt, timezone)}`,
    formatDuration(data.durationMs),
    ...(data.resolvedAt ? [`Resolved ${formatDateTime(data.resolvedAt, timezone)}`] : []),
  ].join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <>
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              to={resourceHref}
            >
              View {resourceLabel} <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            {data.openedByRunId ? (
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
                to={`/w/${current.id}/runs/${data.openedByRunId}`}
              >
                View failing run <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
          </>
        }
        description={meta}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Incident — {data.resourceName}
            <StatusBadge status={data.status} />
          </span>
        }
      />

      <Card title="Timeline">
        <IncidentTimeline
          events={data.events}
          incident={data}
          timezone={timezone}
          workspaceId={current.id}
        />
      </Card>

      <Card className="overflow-hidden" padding="none">
        <div className="px-4 pt-4">
          <h2 className="text-sm font-semibold text-zinc-900">Notifications sent</h2>
        </div>
        <Table
          columns={incidentDeliveryColumns(timezone)}
          empty={<EmptyState className="m-4" title={emptyDeliveriesCopy} />}
          rowKey={(delivery) => delivery.id}
          rows={data.deliveries}
        />
      </Card>
    </div>
  );
}
