export type RunnerWorkerMode = "local" | "fallback" | "cf";

export interface RunnerHeartbeat {
  workerId: string;
  mode: RunnerWorkerMode;
  version: string;
  startedAt: number;
}

export interface RunnerWorker {
  id: string;
  mode: RunnerWorkerMode;
  version: string;
  startedAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
}
