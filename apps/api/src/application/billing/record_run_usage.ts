import type { UsageEventRepo } from "../../domain/billing/repo";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";

export class RecordRunUsage {
  constructor(
    private readonly usageEvents: UsageEventRepo,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    runId: string;
    occurredAt: number;
  }): Promise<string> {
    const existing = await this.usageEvents.findByRunId(input.runId);
    if (existing !== null) return existing.id;

    const id = this.ids.newId("ue");
    const result = await this.usageEvents.insertIfAbsent({
      id,
      workspaceId: input.workspaceId,
      testRunId: input.runId,
      type: "BROWSER_RUN",
      quantity: 1,
      billable: true,
      idempotencyKey: `run:${input.runId}`,
      occurredAt: input.occurredAt,
      reversedAt: null,
      createdAt: this.clock.now(),
    });
    if (result === "inserted") return id;

    const raced = await this.usageEvents.findByRunId(input.runId);
    if (raced === null) {
      throw new Error("Usage idempotency conflict without existing run");
    }
    return raced.id;
  }
}
