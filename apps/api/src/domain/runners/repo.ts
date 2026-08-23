import type { RunnerHeartbeat, RunnerWorker } from "./types";

export interface RunnerWorkerRepo {
  /** UPSERT: inserts on first contact, otherwise refreshes mode/version/started_at/last_seen_at. */
  recordHeartbeat(heartbeat: RunnerHeartbeat, seenAt: number): Promise<void>;
  findById(id: string): Promise<RunnerWorker | null>;
}
