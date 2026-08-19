import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileDown, Info } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { downloadReport, getRun } from "../../api/tests";
import type { AttemptSummary, Run } from "../../api/types";
import { AttemptDetail } from "../../components/AttemptDetail";
import { CopyButton } from "../../components/CopyButton";
import { RunSourceBadge } from "../../components/RunSourceBadge";
import { RunStatusPanel } from "../../components/RunStatusPanel";
import { StatusBadge } from "../../components/StatusBadge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { DescriptionList } from "../../components/ui/DescriptionList";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Spinner";
import { Tooltip } from "../../components/ui/Tooltip";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";
import { formatDateTime, formatDuration } from "../../lib/format";

export const reportNote =
  "The report describes what was observed. It contains no credentials and doesn't assert an unverified root cause.";
export const draftValidationNote =
  "This was a validation run of an unsaved draft. It doesn't open incidents or send alerts.";
export const expiredRunMessage =
  "This run is no longer available (runs are kept for 30 days).";

export function isMissingRun(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function defaultExpandedAttemptId(attempts: AttemptSummary[]): string | null {
  return (
    attempts.find((attempt) => attempt.status === "FAILED")?.id ??
    attempts.at(-1)?.id ??
    null
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function AttemptCard({
  attempt,
  expanded,
  onToggle,
  timezone,
  wsId,
}: {
  attempt: AttemptSummary;
  expanded: boolean;
  onToggle: () => void;
  timezone: string;
  wsId: string;
}) {
  return (
    <Card padding="none">
      <button
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
        type="button"
        onClick={onToggle}
      >
        <span className="font-medium text-zinc-900">Attempt {attempt.attemptIndex + 1}</span>
        <StatusBadge status={attempt.status} />
        <span className="ml-auto text-xs text-zinc-500">
          {formatDuration(attempt.durationMs)}
          {attempt.retryDelaySeconds > 0 ? ` · waited ${attempt.retryDelaySeconds} s` : ""}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded ? (
        <div className="border-t border-zinc-200 p-4">
          <AttemptDetail attemptId={attempt.id} timezone={timezone} wsId={wsId} />
        </div>
      ) : null}
    </Card>
  );
}

export default function RunDetailPage() {
  const { runId = "" } = useParams();
  const { current, timezone } = useWorkspace();
  const toast = useToast();
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const run = useQuery({
    queryFn: () => getRun(current.id, runId),
    queryKey: ["ws", current.id, "runs", runId],
  });

  useEffect(() => {
    if (run.data && expandedAttemptId === null) {
      setExpandedAttemptId(defaultExpandedAttemptId(run.data.attempts));
    }
  }, [expandedAttemptId, run.data]);

  const saveReport = async () => {
    setDownloading(true);
    try {
      const report = await downloadReport(current.id, runId);
      triggerDownload(report.blob, report.filename);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) toast.error("Report not available.");
      else toast.error(apiErrorMessage(error));
    } finally {
      setDownloading(false);
    }
  };

  if (run.isPending) {
    return (
      <div className="grid min-h-64 place-items-center">
        <Spinner label="Loading run" size={6} />
      </div>
    );
  }
  if (run.isError) {
    return (
      <ErrorState
        message={isMissingRun(run.error) ? expiredRunMessage : undefined}
        onRetry={() => void run.refetch()}
      />
    );
  }

  const data: Run = run.data;
  const hasReport = data.status === "FAILED" || data.status === "TIMEOUT";

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
        <Link className="hover:text-zinc-900 hover:underline" to={`/w/${current.id}/tests`}>
          Browser Tests
        </Link>
        <span aria-hidden="true">/</span>
        {data.testId ? (
          <Link
            className="hover:text-zinc-900 hover:underline"
            to={`/w/${current.id}/tests/${data.testId}`}
          >
            {data.snapshot.name}
          </Link>
        ) : (
          <span>Draft validation</span>
        )}
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-zinc-700">Run</span>
      </nav>

      <PageHeader
        actions={
          hasReport ? (
            <div className="flex items-center gap-2">
              <Button loading={downloading} onClick={() => void saveReport()}>
                <FileDown aria-hidden="true" className="size-4" />
                Download report
              </Button>
              <Tooltip content={reportNote}>
                <span
                  aria-label="About reports"
                  className="grid size-8 place-items-center rounded-md text-zinc-500"
                >
                  <Info aria-hidden="true" className="size-4" />
                </span>
              </Tooltip>
            </div>
          ) : undefined
        }
        title="Run"
      />

      {data.testId === null ? (
        <div className="flex items-start gap-2 rounded-lg border border-info-600/20 bg-info-50 p-4 text-sm text-zinc-700">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info-600" />
          <p>{draftValidationNote}</p>
        </div>
      ) : null}

      <Card title="Progress">
        <RunStatusPanel runId={runId} wsId={current.id} />
      </Card>

      <Card title="Run details">
        <DescriptionList
          items={[
            {
              label: "Run ID",
              value: (
                <span className="inline-flex items-center gap-1 font-mono text-xs">
                  {data.id}
                  <CopyButton label="Copy run ID" text={data.id} />
                </span>
              ),
            },
            { label: "Source", value: <RunSourceBadge source={data.source} /> },
            {
              label: "Device",
              value: `${data.snapshot.device === "DESKTOP" ? "Desktop" : "Mobile"} · ${data.snapshot.viewport.width} × ${data.snapshot.viewport.height}`,
            },
            {
              label: "Started",
              value: data.startedAt ? formatDateTime(data.startedAt, timezone) : "—",
            },
            {
              label: "Finished",
              value: data.finishedAt ? formatDateTime(data.finishedAt, timezone) : "—",
            },
            { label: "Total duration", value: formatDuration(data.durationMs) },
            { label: "Attempts", value: data.attemptCount },
            { label: "Billable", value: data.billable ? "1 run" : "Not billed" },
            { label: "Triggered by", value: data.triggeredBy?.name ?? "—" },
            {
              label: "Incident",
              value: data.incidentId ? (
                <Link
                  className="font-medium text-accent-700 hover:underline"
                  to={`/w/${current.id}/incidents/${data.incidentId}`}
                >
                  View incident
                </Link>
              ) : (
                "—"
              ),
            },
            { label: "Model", value: data.snapshot.modelName },
            { label: "Runner", value: data.snapshot.runnerVersion },
          ]}
        />
      </Card>

      <Card title="Instructions used">
        <p className="whitespace-pre-wrap break-words text-sm text-zinc-700">
          {data.snapshot.instructions}
        </p>
        <p className="mt-4 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
          Starting URL: <span className="break-all font-mono">{data.snapshot.startUrl}</span>
        </p>
      </Card>

      <section aria-labelledby="attempts-title" className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900" id="attempts-title">
          Attempts
        </h2>
        {data.attempts.map((attempt) => (
          <AttemptCard
            key={attempt.id}
            attempt={attempt}
            expanded={expandedAttemptId === attempt.id}
            timezone={timezone}
            wsId={current.id}
            onToggle={() =>
              setExpandedAttemptId((currentId) =>
                currentId === attempt.id ? null : attempt.id,
              )
            }
          />
        ))}
      </section>
    </div>
  );
}
