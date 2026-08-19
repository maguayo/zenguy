import type { BillingCanceller } from "../../domain/billing/canceller";

export class RecordingBillingCanceller implements BillingCanceller {
  readonly workspaceIds: string[] = [];

  constructor(private readonly failure: Error | null = null) {}

  async cancelForWorkspace(workspaceId: string): Promise<void> {
    this.workspaceIds.push(workspaceId);
    if (this.failure !== null) throw this.failure;
  }
}
