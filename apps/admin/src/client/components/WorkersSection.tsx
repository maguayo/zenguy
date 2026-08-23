import type { WorkerCurrentAttempt, WorkerSummary, WorkersResponse } from "../../shared/types";
import { formatElapsed, formatNumber, relativeSeconds } from "../lib/format";
import { formatTokens } from "../lib/series";
import { Card } from "./Card";

const MODE_LABEL: Record<WorkerSummary["mode"], string> = {
  fallback: "Fallback (VPS)",
  local: "Primary (Mac)",
};

/**
 * The run a worker is executing right now, as plain text: the admin is not a member
 * of those workspaces, so nothing here links into the customer app.
 */
function attemptLead(attempt: WorkerCurrentAttempt): string {
  return `Running ${attempt.testName ?? "unnamed test"} · ${attempt.workspaceName ?? "unknown workspace"} · `;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="font-mono font-medium text-zinc-900 tabular-nums">{value}</dd>
    </div>
  );
}

function WorkerCard({ now, worker }: { now: number; worker: WorkerSummary }) {
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={`size-2.5 rounded-full ${worker.online ? "bg-ok-600" : "bg-danger-600"}`}
          />
          <span className="font-mono text-xs font-medium text-zinc-900">{worker.id}</span>
        </span>
        <span className={`text-xs font-medium ${worker.online ? "text-ok-700" : "text-danger-700"}`}>
          {worker.online ? "Online" : "Offline"}
        </span>
      </div>
      <p className="mt-2 text-zinc-500">
        {MODE_LABEL[worker.mode]} · <span className="font-mono text-xs">{worker.version}</span>
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        {`seen ${relativeSeconds(worker.lastSeenAt, now)} · up ${formatElapsed(now - worker.startedAt)}`}
      </p>
      {worker.currentAttempt ? (
        <p className="mt-2 text-zinc-900">
          {attemptLead(worker.currentAttempt)}
          <span className="font-mono text-xs">{worker.currentAttempt.runId}</span>
          {worker.currentAttempt.startedAt === null ? null : (
            <span className="text-zinc-500">
              {` · ${formatElapsed(now - worker.currentAttempt.startedAt)}`}
            </span>
          )}
        </p>
      ) : (
        <p className="mt-2 text-zinc-500">Idle</p>
      )}
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-3">
        <Stat label="Runs 24 h" value={formatNumber(worker.runs24h)} />
        <Stat label="Runs 7 d" value={formatNumber(worker.runs7d)} />
        <Stat label="Tokens 24 h" value={formatTokens(worker.tokens24h)} />
      </dl>
    </li>
  );
}

/** One card per worker; the row heading above carries the "N of M online" count. */
export function WorkersSection({ workers }: { workers: WorkersResponse }) {
  if ("unavailable" in workers) {
    return (
      <Card>
        <p className="text-zinc-500">
          Pending production migration — worker heartbeats appear once 0023 reaches the
          production database.
        </p>
      </Card>
    );
  }

  if (workers.workers.length === 0) {
    return (
      <Card>
        <p className="text-zinc-500">No workers have reported yet</p>
      </Card>
    );
  }

  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {workers.workers.map((worker) => (
        <WorkerCard key={worker.id} now={workers.now} worker={worker} />
      ))}
    </ul>
  );
}
