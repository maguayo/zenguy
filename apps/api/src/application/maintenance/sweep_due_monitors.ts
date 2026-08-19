import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { CheckMessage } from "../../domain/queues";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";

const SWEEP_LIMIT = 200;

export interface MonitorSweepResult {
  due: number;
  created: number;
  skipped: number;
}

export interface CheckQueueSender {
  send(message: CheckMessage): Promise<unknown>;
}

export class SweepDueMonitors {
  constructor(
    private readonly monitors: Pick<MonitorRepo, "claimDue" | "openCycle">,
    private readonly workspaces: Pick<WorkspaceRepo, "findById">,
    private readonly subscriptions: Pick<SubscriptionRepo, "findByWorkspace">,
    private readonly queue: CheckQueueSender,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(): Promise<MonitorSweepResult> {
    const now = this.clock.now();
    const claimed = await this.monitors.claimDue(now, SWEEP_LIMIT);
    const result: MonitorSweepResult = {
      due: claimed.length,
      created: 0,
      skipped: 0,
    };
    for (const monitor of claimed) {
      const [workspace, subscription] = await Promise.all([
        this.workspaces.findById(monitor.workspaceId),
        this.subscriptions.findByWorkspace(monitor.workspaceId),
      ]);
      if (
        workspace === null ||
        (subscription?.status !== "ACTIVE" &&
          subscription?.status !== "PAST_DUE")
      ) {
        result.skipped += 1;
        continue;
      }
      const cycleId = this.ids.newId("cyc");
      if (!(await this.monitors.openCycle(monitor.id, cycleId, now))) {
        result.skipped += 1;
        continue;
      }
      await this.queue.send({
        kind: "check",
        monitorId: monitor.id,
        workspaceId: monitor.workspaceId,
        cycleId,
        attemptIndex: 0,
      });
      result.created += 1;
    }
    return result;
  }
}
