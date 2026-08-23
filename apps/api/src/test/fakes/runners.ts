import type { RunnerWorkerRepo } from "../../domain/runners/repo";
import type {
  RunnerHeartbeat,
  RunnerWorker,
} from "../../domain/runners/types";

export class FakeRunnerWorkerRepo implements RunnerWorkerRepo {
  readonly workers = new Map<string, RunnerWorker>();

  async recordHeartbeat(
    heartbeat: RunnerHeartbeat,
    seenAt: number,
  ): Promise<void> {
    const existing = this.workers.get(heartbeat.workerId);
    this.workers.set(heartbeat.workerId, {
      id: heartbeat.workerId,
      mode: heartbeat.mode,
      version: heartbeat.version,
      startedAt: heartbeat.startedAt,
      firstSeenAt: existing?.firstSeenAt ?? seenAt,
      lastSeenAt: seenAt,
    });
  }

  async findById(id: string): Promise<RunnerWorker | null> {
    return this.workers.get(id) ?? null;
  }
}
