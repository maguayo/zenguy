import type { RunArtifact } from "../../domain/browser_tests/types";
import type {
  AuthDebrisCounts,
  CleanupRepo,
  DeletedWorkspacePurgeCounts,
  ExpiredRunBatch,
} from "../../domain/maintenance/repo";
import type { UptimeCheck } from "../../domain/uptime/types";
import { FixedClock } from "../../shared/clock";
import { FakeArtifactRepo } from "../../test/fakes/browser_test_repos";
import { FakeCheckRepo } from "../../test/fakes/uptime_repos";
import { PurgeExpired } from "./purge_expired";

const DAY_MS = 86_400_000;
const NOW = 40 * DAY_MS;

function emptyRunBatch(): ExpiredRunBatch {
  return {
    runIds: [],
    storageKeys: [],
    counts: { runs: 0, attempts: 0, steps: 0, artifacts: 0 },
  };
}

class ScriptedCleanupRepo implements CleanupRepo {
  runBatches: ExpiredRunBatch[] = [
    {
      runIds: Array.from({ length: 200 }, (_, index) => `run_${index}`),
      storageKeys: Array.from({ length: 200 }, (_, index) => `run-key-${index}`),
      counts: { runs: 200, attempts: 200, steps: 200, artifacts: 200 },
    },
    {
      runIds: ["run_200"],
      storageKeys: ["run-key-200"],
      counts: { runs: 1, attempts: 1, steps: 1, artifacts: 1 },
    },
    emptyRunBatch(),
  ];
  deliveryResults = [200, 1, 0];
  authResults: AuthDebrisCounts[] = [
    { emailTokens: 200, refreshTokens: 200, invitations: 200 },
    { emailTokens: 1, refreshTokens: 0, invitations: 0 },
    { emailTokens: 0, refreshTokens: 0, invitations: 0 },
  ];
  workspaceResults: DeletedWorkspacePurgeCounts[] = [
    { workspaces: 1, invitations: 2 },
    { workspaces: 0, invitations: 0 },
  ];
  readonly runLimits: number[] = [];
  readonly deliveryLimits: number[] = [];
  readonly authLimits: number[] = [];
  readonly workspaceLimits: number[] = [];
  readonly deletedRunBatches: string[][] = [];

  async listExpiredRunBatch(_before: number, limit: number): Promise<ExpiredRunBatch> {
    this.runLimits.push(limit);
    return structuredClone(this.runBatches.shift() ?? emptyRunBatch());
  }

  async deleteRunBatch(runIds: string[]): Promise<void> {
    this.deletedRunBatches.push([...runIds]);
  }

  async deleteDeliveriesOlderThan(_before: number, limit: number): Promise<number> {
    this.deliveryLimits.push(limit);
    return this.deliveryResults.shift() ?? 0;
  }

  async deleteAuthDebris(input: {
    emailBefore: number;
    refreshBefore: number;
    invitationBefore: number;
    limit: number;
  }): Promise<AuthDebrisCounts> {
    this.authLimits.push(input.limit);
    expect(input).toMatchObject({
      emailBefore: NOW - 7 * DAY_MS,
      refreshBefore: NOW - 30 * DAY_MS,
      invitationBefore: NOW - 30 * DAY_MS,
    });
    return this.authResults.shift() ?? {
      emailTokens: 0,
      refreshTokens: 0,
      invitations: 0,
    };
  }

  async purgeDeletedWorkspaceOperational(
    _before: number,
    limit: number,
  ): Promise<DeletedWorkspacePurgeCounts> {
    this.workspaceLimits.push(limit);
    return this.workspaceResults.shift() ?? { workspaces: 0, invitations: 0 };
  }
}

class RecordingStorage {
  readonly calls: string[][] = [];

  async delete(keys: string[]): Promise<void> {
    this.calls.push([...keys]);
  }
}

function artifact(index: number): RunArtifact {
  return {
    id: `art_${index}`,
    workspaceId: "ws_cleanup",
    runId: `run_young_${index}`,
    attemptId: null,
    type: "MARKDOWN_REPORT",
    storageKey: `orphan-key-${index}`,
    mimeType: "text/markdown",
    sizeBytes: 1,
    metadataJson: null,
    createdAt: NOW - DAY_MS,
    expiresAt: NOW - 1,
  };
}

function check(index: number): UptimeCheck {
  return {
    id: `chk_${index}`,
    workspaceId: "ws_cleanup",
    uptimeMonitorId: "mon_cleanup",
    cycleId: `cyc_${index}`,
    attemptIndex: 0,
    status: "PASSED",
    httpStatus: 200,
    responseTimeMs: 10,
    failureReason: null,
    responseExcerpt: null,
    checkedAt: NOW - 30 * DAY_MS - 1 - index,
    createdAt: NOW - 30 * DAY_MS - 1 - index,
  };
}

describe("PurgeExpired", () => {
  it("drains every source in bounded batches and logs aggregate counts", async () => {
    const cleanup = new ScriptedCleanupRepo();
    const artifacts = new FakeArtifactRepo();
    const checks = new FakeCheckRepo();
    const storage = new RecordingStorage();
    const logs: { event: string; fields: object | undefined }[] = [];
    for (let index = 0; index < 201; index += 1) {
      await artifacts.insert(artifact(index));
      await checks.insertIfAbsent(check(index));
    }
    const purge = new PurgeExpired(
      cleanup,
      artifacts,
      checks,
      storage,
      new FixedClock(NOW),
      (event, fields) => logs.push({ event, fields }),
    );

    const result = await purge.execute();

    expect(result).toEqual({
      runs: 201,
      attempts: 201,
      steps: 201,
      artifacts: 402,
      checks: 201,
      deliveries: 201,
      tokens: 603,
    });
    expect(cleanup.runLimits).toEqual([200, 200, 200]);
    expect(cleanup.deliveryLimits).toEqual([200, 200, 200]);
    expect(cleanup.authLimits).toEqual([200, 200, 200]);
    expect(cleanup.workspaceLimits).toEqual([200, 200]);
    expect(cleanup.deletedRunBatches.map((batch) => batch.length)).toEqual([
      200,
      1,
    ]);
    expect(storage.calls.map((call) => call.length)).toEqual([200, 1, 200, 1]);
    expect(artifacts.artifacts.size).toBe(0);
    expect(checks.checks.size).toBe(0);
    expect(logs).toEqual([{ event: "cleanup", fields: result }]);
  });
});
