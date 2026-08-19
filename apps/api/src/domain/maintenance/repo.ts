export interface ExpiredRunBatch {
  runIds: string[];
  storageKeys: string[];
  counts: {
    runs: number;
    attempts: number;
    steps: number;
    artifacts: number;
  };
}

export interface AuthDebrisCounts {
  emailTokens: number;
  refreshTokens: number;
  invitations: number;
}

export interface DeletedWorkspacePurgeCounts {
  workspaces: number;
  invitations: number;
}

export interface CleanupRepo {
  listExpiredRunBatch(
    before: number,
    limit: number,
  ): Promise<ExpiredRunBatch>;
  deleteRunBatch(runIds: string[]): Promise<void>;
  deleteDeliveriesOlderThan(before: number, limit: number): Promise<number>;
  deleteAuthDebris(input: {
    emailBefore: number;
    refreshBefore: number;
    invitationBefore: number;
    limit: number;
  }): Promise<AuthDebrisCounts>;
  purgeDeletedWorkspaceOperational(
    before: number,
    limit: number,
  ): Promise<DeletedWorkspacePurgeCounts>;
}
