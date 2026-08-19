import type { BillingCanceller } from "../../domain/billing/canceller";

export class NoopBillingCanceller implements BillingCanceller {
  async cancelForWorkspace(_workspaceId: string): Promise<void> {}
}
