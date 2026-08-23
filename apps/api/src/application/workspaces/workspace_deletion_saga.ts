import type { BillingCanceller } from "../../domain/billing/canceller";
import type {
  WorkspaceDeletionClaim,
  WorkspaceDeletionRepo,
} from "../../domain/workspaces/deletion";
import type { Clock } from "../../shared/clock";
import { platformAlert, type LogFields } from "../../shared/log";

const CLAIM_LEASE_MS = 10 * 60_000;
const MAX_BATCH = 25;
const MAX_RETRY_MS = 24 * 60 * 60_000;

export interface WorkspaceArtifactDeleter {
  delete(keys: string[]): Promise<void>;
  deletePrefix?(prefix: string): Promise<void>;
}

type PlatformAlerter = (event: string, fields?: LogFields) => void;

function retryDelay(attemptCount: number): number {
  return Math.min(MAX_RETRY_MS, 60_000 * 2 ** Math.min(attemptCount, 10));
}

export class WorkspaceDeletionSaga {
  constructor(
    private readonly deletions: WorkspaceDeletionRepo,
    private readonly billing: BillingCanceller,
    private readonly storage: WorkspaceArtifactDeleter,
    private readonly clock: Clock,
    private readonly alert: PlatformAlerter = platformAlert,
  ) {}

  /**
   * Commits the tombstone/quiesce transaction before attempting any external
   * effect. Provider/storage failures are persisted and never roll visibility
   * back to ACTIVE.
   */
  async request(workspaceId: string): Promise<boolean> {
    const started = await this.deletions.requestTombstone(
      workspaceId,
      this.clock.now(),
    );
    if (started) await this.resumeWorkspace(workspaceId);
    return started;
  }

  /** Scheduled entrypoint: leases and resumes all due deletion stages. */
  async execute(): Promise<{ processed: number; completed: number }> {
    let processed = 0;
    let completed = 0;
    while (processed < MAX_BATCH) {
      const now = this.clock.now();
      const claim = await this.deletions.claimDue({
        now,
        staleBefore: now - CLAIM_LEASE_MS,
      });
      if (claim === null) break;
      processed += 1;
      if (await this.process(claim)) completed += 1;
    }
    return { processed, completed };
  }

  private async resumeWorkspace(workspaceId: string): Promise<void> {
    // There are exactly two successful external stages: cancellation, then
    // object purge. Processing both immediately keeps the common path fast;
    // each remains independently recoverable by the scheduled worker.
    for (let stage = 0; stage < 2; stage += 1) {
      const now = this.clock.now();
      const claim = await this.deletions.claimDue({
        workspaceId,
        now,
        staleBefore: now - CLAIM_LEASE_MS,
      });
      if (claim === null) return;
      const completed = await this.process(claim);
      if (!completed && claim.stage !== "CANCELLATION_PENDING") return;
    }
  }

  private async process(claim: WorkspaceDeletionClaim): Promise<boolean> {
    if (claim.stage === "CANCELLATION_PENDING") {
      try {
        // Paddle DELETE is retried with the same provider subscription id;
        // local cancellation is written only after the provider confirms it.
        await this.billing.cancelForWorkspace(claim.workspaceId);
        await this.deletions.markCancellationSucceeded(
          claim.workspaceId,
          this.clock.now(),
        );
        return false;
      } catch {
        await this.fail(claim, "Workspace subscription cancellation failed");
        return false;
      }
    }

    try {
      const storageKeys = await this.deletions.listArtifactStorageKeys(
        claim.workspaceId,
      );
      if (this.storage.deletePrefix !== undefined) {
        await this.storage.deletePrefix(`ws/${claim.workspaceId}/`);
      } else if (storageKeys.length > 0) {
        await this.storage.delete(storageKeys);
      }
      await this.deletions.purgeAndAnonymize(
        claim.workspaceId,
        this.clock.now(),
      );
      return true;
    } catch {
      await this.fail(claim, "Workspace data purge failed");
      return false;
    }
  }

  private async fail(
    claim: WorkspaceDeletionClaim,
    message: string,
  ): Promise<void> {
    const now = this.clock.now();
    const attempt = claim.attemptCount + 1;
    await this.deletions.recordFailure({
      workspaceId: claim.workspaceId,
      stage: claim.stage,
      failedAt: now,
      retryAt: now + retryDelay(attempt),
      error: message,
    });
    this.alert("workspace_deletion_retry_scheduled", {
      workspaceId: claim.workspaceId,
      stage: claim.stage,
      attempt,
    });
  }
}
