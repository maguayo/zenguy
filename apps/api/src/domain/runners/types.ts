export type RunnerWorkerMode = "local" | "fallback";

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
