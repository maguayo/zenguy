import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import { isAppError } from "../../shared/errors";
import { logEvent, type LogFields } from "../../shared/log";

const SWEEP_LIMIT = 200;

export interface SchedulerSweepResult {
  due: number;
  created: number;
  skipped: number;
}

export interface ScheduledRunCreator {
  execute(input: {
    workspaceId: string;
    source: "SCHEDULED";
    testId: string;
    scheduledFor: number;
  }): Promise<unknown>;
}

type EventLogger = (event: string, fields?: LogFields) => void;

function isExpectedRunConflict(error: unknown): boolean {
  return (
    isAppError(error) &&
    (error.code === "ACTIVE_RUN_EXISTS" || error.code === "CONFLICT")
  );
}

export class SweepDueTests {
  constructor(
    private readonly tests: Pick<BrowserTestRepo, "claimDue">,
    private readonly runs: Pick<RunRepo, "activeRunExists">,
    private readonly workspaces: Pick<WorkspaceRepo, "findById">,
    private readonly subscriptions: Pick<SubscriptionRepo, "findByWorkspace">,
    private readonly createRun: ScheduledRunCreator,
    private readonly clock: Clock,
    private readonly logger: EventLogger = logEvent,
  ) {}

  async execute(): Promise<SchedulerSweepResult> {
    const now = this.clock.now();
    const claimed = await this.tests.claimDue(now, SWEEP_LIMIT);
    const result: SchedulerSweepResult = {
      due: claimed.length,
      created: 0,
      skipped: 0,
    };
    for (const test of claimed) {
      const [workspace, subscription] = await Promise.all([
        this.workspaces.findById(test.workspaceId),
        this.subscriptions.findByWorkspace(test.workspaceId),
      ]);
      if (
        workspace === null ||
        (subscription?.status !== "ACTIVE" &&
          subscription?.status !== "PAST_DUE") ||
        (await this.runs.activeRunExists(test.id))
      ) {
        result.skipped += 1;
        continue;
      }
      try {
        await this.createRun.execute({
          workspaceId: test.workspaceId,
          source: "SCHEDULED",
          testId: test.id,
          scheduledFor: test.scheduledFor,
        });
        result.created += 1;
      } catch (error) {
        if (!isExpectedRunConflict(error)) throw error;
        result.skipped += 1;
      }
    }
    this.logger("scheduler_tests", { ...result });
    return result;
  }
}
