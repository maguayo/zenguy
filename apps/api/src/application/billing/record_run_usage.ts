import type { UsageEventRepo } from "../../domain/billing/repo";
import type { UsageEvent } from "../../domain/billing/types";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";

interface RunUsageInput {
  workspaceId: string;
  runId: string;
  occurredAt: number;
}

export class RecordRunUsage {
  constructor(
    private readonly usageEvents: UsageEventRepo,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  buildEvent(input: RunUsageInput): UsageEvent {
    return {
      id: this.ids.newId("ue"),
      workspaceId: input.workspaceId,
      testRunId: input.runId,
      type: "BROWSER_RUN",
      quantity: 1,
      billable: true,
      idempotencyKey: `run:${input.runId}`,
      occurredAt: input.occurredAt,
      reversedAt: null,
      createdAt: this.clock.now(),
    };
  }

  async execute(input: RunUsageInput): Promise<string> {
    const existing = await this.usageEvents.findByRunId(input.runId);
    if (existing !== null) return existing.id;

    const event = this.buildEvent(input);
    const result = await this.usageEvents.insertIfAbsent(event);
    if (result === "inserted") return event.id;

    const raced = await this.usageEvents.findByRunId(input.runId);
    if (raced === null) {
      throw new Error("Usage idempotency conflict without existing run");
    }
    return raced.id;
  }
}
