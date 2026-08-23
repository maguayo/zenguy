import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ImageOff } from "lucide-react";
import clsx from "clsx";

import { getAttempt } from "../api/tests";
import type { ArtifactRef, Attempt, AttemptSummary, Step } from "../api/types";
import { itemQueryErrorMessage } from "../lib/errors";
import { formatTime } from "../lib/format";
import { filmstripItems } from "./ScreenshotFilmstrip";
import { ScreenshotViewer, type ScreenshotItem } from "./ScreenshotViewer";
import { StatusBadge } from "./StatusBadge";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";
import { ErrorState } from "./ui/ErrorState";
import { Skeleton } from "./ui/Skeleton";
import { Tooltip } from "./ui/Tooltip";

export function screenshotItems(attempt: Attempt): ScreenshotItem[] {
  return filmstripItems(attempt);
}

const RUNNER_KIND_LABELS = { fallback: "Fallback", primary: "Primary" } as const;

export function runnerLabel(
  attempt: Pick<AttemptSummary, "runnerKind" | "runnerVersion">,
): string {
  if (attempt.runnerKind !== null) return RUNNER_KIND_LABELS[attempt.runnerKind];
  return attempt.runnerVersion ?? "—";
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

export function tokensLine(
  attempt: Pick<
    AttemptSummary,
    "inputTokens" | "modelName" | "outputTokens" | "runnerKind" | "runnerVersion" | "tokenUsage"
  >,
): string {
  const breakdown =
    attempt.inputTokens !== null && attempt.outputTokens !== null
      ? ` (${count(attempt.inputTokens)} in · ${count(attempt.outputTokens)} out)`
      : "";
  const tokens = attempt.tokenUsage === null ? "—" : `${count(attempt.tokenUsage)}${breakdown}`;
  return `Tokens: ${tokens} · Model: ${attempt.modelName ?? "—"} · Runner: ${runnerLabel(attempt)}`;
}

function EmptyCapture() {
  return <p className="text-sm italic text-zinc-500">None captured</p>;
}

function DisclosureCard({
  children,
  count,
  title,
}: {
  children: ReactNode;
  count: number;
  title: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card padding="none">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-sm font-semibold text-zinc-900">
          {title} ({count})
        </span>
        <ChevronDown
          aria-hidden="true"
          className={clsx("size-4 text-zinc-500 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? <div className="border-t border-zinc-200 p-4">{children}</div> : null}
    </Card>
  );
}

function ScreenshotThumbnail({
  onOpen,
  screenshot,
  sequence,
}: {
  onOpen: () => void;
  screenshot: ArtifactRef;
  sequence: number;
}) {
  const [expired, setExpired] = useState(false);

  return (
    <button
      aria-label={`Open step ${sequence} screenshot`}
      className="mt-3 block h-24 w-40 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 text-zinc-500 transition hover:border-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2"
      type="button"
      onClick={onOpen}
    >
      {expired ? (
        <span className="grid h-full place-items-center gap-1 text-xs">
          <ImageOff aria-hidden="true" className="size-5" />
          Screenshot expired
        </span>
      ) : (
        <img
          alt={`Step ${sequence} screenshot`}
          className="h-24 w-full object-cover"
          loading="lazy"
          src={screenshot.url}
          onError={() => setExpired(true)}
        />
      )}
    </button>
  );
}

function StepTimeline({
  onOpenScreenshot,
  screenshots,
  steps,
  timezone,
}: {
  onOpenScreenshot: (index: number) => void;
  screenshots: ScreenshotItem[];
  steps: Step[];
  timezone: string;
}) {
  if (steps.length === 0) return <EmptyCapture />;

  return (
    <ol className="space-y-0">
      {steps.map((step, index) => {
        const screenshotIndex = step.screenshot
          ? screenshots.findIndex((screenshot) => screenshot.id === step.screenshot?.id)
          : -1;
        return (
          <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-5 last:pb-0" key={step.sequence}>
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-[0.9375rem] top-8 w-px bg-zinc-200"
              />
            ) : null}
            <span className="relative z-10 grid size-8 place-items-center rounded-full border border-zinc-200 bg-white text-xs font-semibold text-zinc-700">
              {step.sequence}
            </span>
            <div className="min-w-0 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="font-mono" tone="neutral">
                  {step.actionType}
                </Badge>
                <span
                  aria-hidden="true"
                  className={clsx(
                    "size-2 rounded-full",
                    step.result === "OK" ? "bg-ok-600" : "bg-danger-600",
                  )}
                />
                <span
                  className={clsx(
                    "text-xs font-medium",
                    step.result === "OK" ? "text-ok-700" : "text-danger-700",
                  )}
                >
                  {step.result === "OK" ? "OK" : "Error"}
                </span>
                <time className="ml-auto text-xs tabular-nums text-zinc-500" dateTime={step.timestamp}>
                  {formatTime(step.timestamp, timezone)}
                </time>
              </div>
              <p className="mt-2 text-sm text-zinc-800">{step.description}</p>
              {step.urlSanitized ? (
                <Tooltip className="mt-1 max-w-full" content={step.urlSanitized}>
                  <span className="block max-w-full truncate font-mono text-xs text-zinc-500">
                    {step.urlSanitized}
                  </span>
                </Tooltip>
              ) : null}
              {step.screenshot ? (
                <ScreenshotThumbnail
                  screenshot={step.screenshot}
                  sequence={step.sequence}
                  onOpen={() => onOpenScreenshot(Math.max(0, screenshotIndex))}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function AttemptDetail({
  attemptId,
  timezone,
  wsId,
}: {
  attemptId: string;
  timezone: string;
  wsId: string;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const attempt = useQuery({
    queryFn: () => getAttempt(wsId, attemptId),
    queryKey: ["ws", wsId, "attempts", attemptId],
  });

  if (attempt.isPending) {
    return (
      <div aria-label="Loading attempt" className="space-y-2" role="status">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (attempt.isError) {
    return (
      <ErrorState
        message={itemQueryErrorMessage(attempt.error)}
        onRetry={() => void attempt.refetch()}
      />
    );
  }

  const data = attempt.data;
  const screenshots = screenshotItems(data);
  const failed = data.status === "FAILED" || data.status === "TIMEOUT";

  return (
    <div className="space-y-4">
      <div
        className={clsx(
          "rounded-lg border p-4",
          failed
            ? "border-danger-600/20 bg-danger-50/60"
            : data.status === "PASSED"
              ? "border-ok-600/20 bg-ok-50/60"
              : "border-zinc-200 bg-zinc-50",
        )}
      >
        <div className="flex flex-wrap items-start gap-2">
          <StatusBadge status={data.status} />
          <p className="min-w-0 flex-1 text-sm font-medium text-zinc-900">
            {data.summary ?? "No summary was recorded."}
          </p>
        </div>
        {failed && data.failureReason ? (
          <p className="mt-3 rounded-md border border-danger-600/20 bg-white/70 px-3 py-2 text-sm text-danger-700">
            {data.failureReason}
          </p>
        ) : null}
        {failed ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-zinc-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Expected</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-800">
                {data.expectedResult ?? "—"}
              </p>
            </div>
            <div className="rounded-md border border-danger-600/20 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Observed</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-800">
                {data.actualResult ?? "—"}
              </p>
            </div>
          </div>
        ) : null}
        {data.status === "SYSTEM_ERROR" && data.systemErrorCode ? (
          <p className="mt-3 font-mono text-xs text-zinc-600">
            System error code: {data.systemErrorCode}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-zinc-500" title={data.runnerVersion ?? undefined}>
          {tokensLine(data)}
        </p>
      </div>

      <Card title="Steps timeline">
        <StepTimeline
          screenshots={screenshots}
          steps={data.steps}
          timezone={timezone}
          onOpenScreenshot={setViewerIndex}
        />
      </Card>

      <DisclosureCard count={data.consoleErrors.length} title="Console errors">
        {data.consoleErrors.length === 0 ? (
          <EmptyCapture />
        ) : (
          <ul className="space-y-2 font-mono text-xs text-zinc-700">
            {data.consoleErrors.map((error, index) => (
              <li className="break-words" key={`${error.timestamp}-${index}`}>
                <span className="font-semibold">{error.level}</span> · {error.message} · {error.url ?? "—"}
              </li>
            ))}
          </ul>
        )}
      </DisclosureCard>

      <DisclosureCard count={data.networkErrors.length} title="Network errors">
        {data.networkErrors.length === 0 ? (
          <EmptyCapture />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-xs">
              <thead className="text-zinc-500">
                <tr className="border-b border-zinc-200">
                  <th className="pb-2 pr-4 font-medium">Method</th>
                  <th className="pb-2 pr-4 font-medium">Host</th>
                  <th className="pb-2 pr-4 font-medium">Path</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="font-mono text-zinc-700">
                {data.networkErrors.map((error, index) => (
                  <tr className="border-b border-zinc-100 last:border-0" key={`${error.method}-${error.host}-${error.path}-${index}`}>
                    <td className="py-2 pr-4">{error.method}</td>
                    <td className="py-2 pr-4">{error.host}</td>
                    <td className="max-w-64 truncate py-2 pr-4" title={error.path}>{error.path}</td>
                    <td className="py-2 pr-4">{error.statusCode ?? "—"}</td>
                    <td className="py-2">{error.errorType ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DisclosureCard>

      <DisclosureCard count={data.visitedUrls.length} title="Visited URLs">
        {data.visitedUrls.length === 0 ? (
          <EmptyCapture />
        ) : (
          <ol className="list-decimal space-y-2 pl-5 font-mono text-xs text-zinc-700">
            {data.visitedUrls.map((url, index) => (
              <li className="break-all pl-1" key={`${url}-${index}`}>{url}</li>
            ))}
          </ol>
        )}
      </DisclosureCard>

      <ScreenshotViewer
        initialIndex={viewerIndex ?? 0}
        open={viewerIndex !== null}
        screenshots={screenshots}
        onClose={() => setViewerIndex(null)}
      />
    </div>
  );
}
