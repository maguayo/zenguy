import type { UsageEventRepo } from "../../domain/billing/repo";
import type { Clock } from "../../shared/clock";

export class ReverseRunUsage {
  constructor(
    private readonly usageEvents: UsageEventRepo,
    private readonly clock: Clock,
  ) {}

  async execute(input: { runId: string }): Promise<void> {
    await this.usageEvents.reverseByRunId(input.runId, this.clock.now());
  }
}
