export interface BillingCanceller {
  cancelForWorkspace(workspaceId: string): Promise<void>;
}
