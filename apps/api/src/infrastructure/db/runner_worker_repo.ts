import type { RunnerWorkerRepo } from "../../domain/runners/repo";
import type {
  RunnerHeartbeat,
  RunnerWorker,
  RunnerWorkerMode,
} from "../../domain/runners/types";
import { one, run } from "./d1";

interface RunnerWorkerRow {
  id: string;
  mode: RunnerWorkerMode;
  version: string;
  started_at: number;
  first_seen_at: number;
  last_seen_at: number;
}

export class D1RunnerWorkerRepo implements RunnerWorkerRepo {
  constructor(private readonly database: D1Database) {}

  async recordHeartbeat(
    heartbeat: RunnerHeartbeat,
    seenAt: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO runner_workers
             (id, mode, version, started_at, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             mode = excluded.mode,
             version = excluded.version,
             started_at = excluded.started_at,
             last_seen_at = excluded.last_seen_at`,
        )
        .bind(
          heartbeat.workerId,
          heartbeat.mode,
          heartbeat.version,
          heartbeat.startedAt,
          seenAt,
          seenAt,
        ),
    );
  }

  async findById(id: string): Promise<RunnerWorker | null> {
    const row = await one<RunnerWorkerRow>(
      this.database
        .prepare(
          `SELECT id, mode, version, started_at, first_seen_at, last_seen_at
           FROM runner_workers WHERE id = ?`,
        )
        .bind(id),
    );
    return row === null
      ? null
      : {
          id: row.id,
          mode: row.mode,
          version: row.version,
          startedAt: row.started_at,
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
        };
  }
}
