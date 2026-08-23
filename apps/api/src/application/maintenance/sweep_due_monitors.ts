import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { CheckMessage } from "../../domain/queues";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import type { DurableWorkflowRepo } from "../../domain/durability/repo";
import { createOutboxEntry } from "../durability/factory";
import type { PublishQueueOutbox } from "../durability/publish_outbox";
import { platformAlert } from "../../shared/log";
import { subscriptionAllowsExecution } from "../billing/ensure_active_subscription";

const SWEEP_LIMIT = 200;

export interface MonitorSweepResult {
  due: number;
  created: number;
  skipped: number;
}

export class SweepDueMonitors {
  constructor(
    private readonly monitors: Pick<MonitorRepo, "claimDue">,
    private readonly workspaces: Pick<WorkspaceRepo, "findById">,
    private readonly subscriptions: Pick<SubscriptionRepo, "findByWorkspace">,
    private readonly durable: Pick<
      DurableWorkflowRepo,
      "openMonitorCycleWithOutbox"
    >,
    private readonly outboxPublisher: Pick<PublishQueueOutbox, "publishById">,
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
        !subscriptionAllowsExecution(subscription, now)
      ) {
        result.skipped += 1;
        continue;
      }
      const cycleId = this.ids.newId("cyc");
      const message: CheckMessage = {
        kind: "check",
        monitorId: monitor.id,
        workspaceId: monitor.workspaceId,
        cycleId,
        attemptIndex: 0,
      };
      const outbox = createOutboxEntry({
        dedupeKey: `check:${cycleId}:0`,
        queueKind: "CHECK",
        payload: message,
        availableAt: now,
        now,
        ids: this.ids,
      });
      if (!(await this.durable.openMonitorCycleWithOutbox({
        monitorId: monitor.id,
        cycleId,
        at: now,
        outbox,
      }))) {
        result.skipped += 1;
        continue;
      }
      try {
        await this.outboxPublisher.publishById(outbox.id);
      } catch {
        platformAlert("initial_check_publish_deferred", {
          monitorId: monitor.id,
          cycleId,
          outboxId: outbox.id,
        });
      }
      result.created += 1;
    }
    return result;
  }
}
