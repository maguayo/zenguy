import type { AttemptStatus, RunStatus } from "@/api/types";

/** QUEUED and RUNNING are the only states that still change. */
export function isTerminalRun(status: RunStatus): boolean {
  return status !== "QUEUED" && status !== "RUNNING";
}

export function attemptSymbol(status: AttemptStatus): string {
  if (status === "PASSED") return "✓";
  if (status === "FAILED") return "✗";
  if (status === "TIMEOUT") return "⏱";
  if (status === "SYSTEM_ERROR") return "⚙";
  return "…";
}

export function attemptCountLabel(count: number): string {
  return `${count} attempt${count === 1 ? "" : "s"}`;
}

/** Milliseconds for the elapsed counter: live runs count from their start, finished runs show their duration. */
export function elapsedMs(
  run: { durationMs: number | null; startedAt: string | null; status: RunStatus },
  now: number,
): number | null {
  if (!run.startedAt) return null;
  if (isTerminalRun(run.status)) return run.durationMs;
  return Math.max(0, now - new Date(run.startedAt).getTime());
}
