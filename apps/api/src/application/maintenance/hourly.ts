import type {
  AttemptRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { TestAttempt, TestRun } from "../../domain/browser_tests/types";
import type { MonitorRepo as UptimeMonitorRepo } from "../../domain/uptime/repo";
import type { Clock } from "../../shared/clock";
import { ATTEMPT_TIMEOUT_MS } from "../../shared/constants";
import { platformAlert, type LogFields } from "../../shared/log";
import type { AttemptOutcome } from "../execution/attempt_lifecycle";

const ZOMBIE_ATTEMPT_GRACE_MS = 600_000;
const ZOMBIE_CYCLE_MS = 900_000;

export interface HourlyMaintenanceResult {
  zombieAttempts: number;
  zombieCycles: number;
}

export interface OverageSweeper {
  execute(): Promise<unknown>;
}

export interface AttemptFinisher {
  onAttemptFinished(
    run: TestRun,
    attempt: TestAttempt,
    outcome: AttemptOutcome,
  ): Promise<void>;
}

type PlatformAlerter = (event: string, fields?: LogFields) => void;

export class HourlyMaintenance {
  constructor(
    private readonly overages: OverageSweeper,
    private readonly attempts: Pick<AttemptRepo, "listStale">,
    private readonly runs: Pick<RunRepo, "findByIdForExecution">,
    private readonly lifecycle: AttemptFinisher,
    private readonly monitors: Pick<
      UptimeMonitorRepo,
      "listZombieCycles" | "clearCycle"
    >,
    private readonly clock: Clock,
    private readonly alert: PlatformAlerter = platformAlert,
  ) {}

  async execute(): Promise<HourlyMaintenanceResult> {
    await this.overages.execute();
    const now = this.clock.now();
    const staleAttempts = await this.attempts.listStale(
      now - ATTEMPT_TIMEOUT_MS - ZOMBIE_ATTEMPT_GRACE_MS,
    );
    let zombieAttempts = 0;
    for (const attempt of staleAttempts) {
      this.alert("zombie_attempt", {
        runId: attempt.testRunId,
        attemptId: attempt.id,
      });
      const run = await this.runs.findByIdForExecution(attempt.testRunId);
      if (run === null) continue;
      await this.lifecycle.onAttemptFinished(run, attempt, {
        status: "SYSTEM_ERROR",
        systemErrorCode: "WORKER_LOST",
        failureReason: "Attempt worker stopped responding",
        visitedUrls: [],
        consoleErrors: [],
        networkErrors: [],
      });
      zombieAttempts += 1;
    }

    const staleCycles = await this.monitors.listZombieCycles(
      now - ZOMBIE_CYCLE_MS,
    );
    let zombieCycles = 0;
    for (const monitor of staleCycles) {
      if (monitor.currentCycleId === null) continue;
      const cleared = await this.monitors.clearCycle(
        monitor.id,
        monitor.currentCycleId,
      );
      if (!cleared) continue;
      zombieCycles += 1;
      this.alert("zombie_cycle", {
        workspaceId: monitor.workspaceId,
        monitorId: monitor.id,
        cycleId: monitor.currentCycleId,
      });
    }
    return { zombieAttempts, zombieCycles };
  }
}
