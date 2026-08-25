import type { WorkerCurrentAttempt, WorkerSummary, WorkersResponse } from "../../shared/types";
import { formatElapsed, relativeSeconds } from "../lib/format";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";

const MODE_LABEL: Record<WorkerSummary["mode"], string> = {
  cf: "Cloudflare (Containers)",
  fallback: "Fallback (VPS)",
  local: "Primary (Mac)",
};

/** The run a worker is executing right now, as plain text: the admin is not a member
 * of those workspaces, so nothing here links into the customer app. */
function attemptLead(attempt: WorkerCurrentAttempt): string {
  return `Running ${attempt.testName ?? "unnamed test"} · ${attempt.workspaceName ?? "unknown workspace"} · `;
}

function WorkerCard({ now, worker }: { now: number; worker: WorkerSummary }) {
  return (
    <li className="rounded-md border border-zinc-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium text-zinc-900">{worker.id}</span>
        <StatusBadge label={worker.online ? "Online" : "Offline"} />
      </div>
      <p className="mt-1 text-zinc-500">
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
    </li>
  );
}

export function WorkersSection({ workers }: { workers: WorkersResponse }) {
  if ("unavailable" in workers) {
    return (
      <Card title="Workers">
        <p className="text-zinc-500">
          Pending production migration — worker heartbeats appear once 0023 reaches the
          production database.
        </p>
      </Card>
    );
  }

  const online = workers.workers.filter((worker) => worker.online).length;

  return (
    <Card
      aside={workers.workers.length === 0 ? undefined : `${online} of ${workers.workers.length} online`}
      title="Workers"
    >
      {workers.workers.length === 0 ? (
        <p className="text-zinc-500">No workers have reported yet</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {workers.workers.map((worker) => (
            <WorkerCard key={worker.id} now={workers.now} worker={worker} />
          ))}
        </ul>
      )}
    </Card>
  );
}
