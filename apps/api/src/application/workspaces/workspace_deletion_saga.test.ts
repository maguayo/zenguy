import type { BillingCanceller } from "../../domain/billing/canceller";
import type {
  WorkspaceDeletionClaim,
  WorkspaceDeletionRepo,
  WorkspaceDeletionStage,
} from "../../domain/workspaces/deletion";
import { FixedClock } from "../../shared/clock";
import { WorkspaceDeletionSaga } from "./workspace_deletion_saga";

class FakeDeletionRepo implements WorkspaceDeletionRepo {
  stage: "ACTIVE" | WorkspaceDeletionStage | "COMPLETED" = "ACTIVE";
  retryAt = 0;
  attemptCount = 0;
  processing = false;
  failures: Parameters<WorkspaceDeletionRepo["recordFailure"]>[0][] = [];
  purged = false;
  artifactKeys = ["ws/ws_1/run/run_1/artifact.jpg"];

  async requestTombstone(): Promise<boolean> {
    if (this.stage !== "ACTIVE") return false;
    this.stage = "DELETION_PENDING";
    return true;
  }

  async claimDue(input: {
    now: number;
    staleBefore: number;
    workspaceId?: string;
  }): Promise<WorkspaceDeletionClaim | null> {
    if (
      this.stage === "ACTIVE" ||
      this.stage === "COMPLETED" ||
      this.processing ||
      this.retryAt > input.now
    ) {
      return null;
    }
    if (this.stage === "DELETION_PENDING") {
      this.stage = "CANCELLATION_PENDING";
    }
    this.processing = true;
    return {
      workspaceId: input.workspaceId ?? "ws_1",
      stage: this.stage,
      attemptCount: this.attemptCount,
    };
  }

  async markCancellationSucceeded(): Promise<void> {
    this.stage = "PURGE_PENDING";
    this.processing = false;
    this.retryAt = 0;
    this.attemptCount = 0;
  }

  async recordFailure(
    input: Parameters<WorkspaceDeletionRepo["recordFailure"]>[0],
  ): Promise<void> {
    this.failures.push(input);
    this.processing = false;
    this.retryAt = input.retryAt;
    this.attemptCount += 1;
  }

  async listArtifactStorageKeys(): Promise<string[]> {
    return [...this.artifactKeys];
  }

  async purgeAndAnonymize(): Promise<void> {
    this.purged = true;
    this.stage = "COMPLETED";
    this.processing = false;
  }

  async isOperational(): Promise<boolean> {
    return this.stage === "ACTIVE";
  }
}

class MutableCanceller implements BillingCanceller {
  calls = 0;
  failure: Error | null = null;

  async cancelForWorkspace(): Promise<void> {
    this.calls += 1;
    if (this.failure !== null) throw this.failure;
  }
}

class MutableStorage {
  calls: string[][] = [];
  failure: Error | null = null;

  async delete(keys: string[]): Promise<void> {
    this.calls.push(keys);
    if (this.failure !== null) throw this.failure;
  }
}

describe("WorkspaceDeletionSaga", () => {
  it("runs cancellation and R2/DB purge as two recoverable stages", async () => {
    const repo = new FakeDeletionRepo();
    const billing = new MutableCanceller();
    const storage = new MutableStorage();
    const saga = new WorkspaceDeletionSaga(
      repo,
      billing,
      storage,
      new FixedClock(10_000),
      () => undefined,
    );

    await expect(saga.request("ws_1")).resolves.toBe(true);

    expect(billing.calls).toBe(1);
    expect(storage.calls).toEqual([repo.artifactKeys]);
    expect(repo.stage).toBe("COMPLETED");
    expect(repo.purged).toBe(true);
  });

  it("keeps CANCELLATION_PENDING and schedules durable backoff on Paddle failure", async () => {
    const repo = new FakeDeletionRepo();
    const billing = new MutableCanceller();
    billing.failure = new Error("provider unavailable");
    const storage = new MutableStorage();
    const clock = new FixedClock(20_000);
    const alerts: string[] = [];
    const saga = new WorkspaceDeletionSaga(
      repo,
      billing,
      storage,
      clock,
      (event) => alerts.push(event),
    );

    await expect(saga.request("ws_1")).resolves.toBe(true);

    expect(repo.stage).toBe("CANCELLATION_PENDING");
    expect(repo.failures).toEqual([
      expect.objectContaining({
        workspaceId: "ws_1",
        stage: "CANCELLATION_PENDING",
        failedAt: 20_000,
        error: "Workspace subscription cancellation failed",
      }),
    ]);
    expect(repo.failures[0]?.retryAt).toBeGreaterThan(20_000);
    expect(storage.calls).toEqual([]);
    expect(alerts).toEqual(["workspace_deletion_retry_scheduled"]);
  });

  it("retries an R2 purge without repeating successful Paddle cancellation", async () => {
    const repo = new FakeDeletionRepo();
    const billing = new MutableCanceller();
    const storage = new MutableStorage();
    storage.failure = new Error("R2 unavailable");
    const clock = new FixedClock(30_000);
    const saga = new WorkspaceDeletionSaga(
      repo,
      billing,
      storage,
      clock,
      () => undefined,
    );

    await saga.request("ws_1");
    expect(repo.stage).toBe("PURGE_PENDING");
    expect(repo.purged).toBe(false);
    expect(billing.calls).toBe(1);

    storage.failure = null;
    clock.advance(5 * 60_000);
    await saga.execute();

    expect(repo.stage).toBe("COMPLETED");
    expect(billing.calls).toBe(1);
    expect(storage.calls).toHaveLength(2);
  });
});
