import type { ActivityEventType } from "../../domain/activity/catalog";
import type { ActivityEvent } from "../../domain/activity/types";
import type { RunArtifact } from "../../domain/browser_tests/types";
import type {
  AuthDebrisCounts,
  CleanupRepo,
  DeletedWorkspacePurgeCounts,
  ExpiredRunBatch,
} from "../../domain/maintenance/repo";
import type { UptimeCheck } from "../../domain/uptime/types";
import { FixedClock } from "../../shared/clock";
import { FakeActivityEventRepo } from "../../test/fakes/activity";
import { FakeArtifactRepo } from "../../test/fakes/browser_test_repos";
import { FakeCheckRepo } from "../../test/fakes/uptime_repos";
import { PurgeExpired } from "./purge_expired";

const DAY_MS = 86_400_000;
// Past the longest retention window (365 days) so every seeded timestamp is positive.
const NOW = 400 * DAY_MS;

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
  rateLimitResults = [200, 1, 0];
  authResults: AuthDebrisCounts[] = [
    { emailTokens: 200, refreshTokens: 200, invitations: 200, adminSessions: 200 },
    { emailTokens: 1, refreshTokens: 0, invitations: 0, adminSessions: 1 },
    { emailTokens: 0, refreshTokens: 0, invitations: 0, adminSessions: 0 },
  ];
  workspaceResults: DeletedWorkspacePurgeCounts[] = [
    { workspaces: 1, invitations: 2 },
    { workspaces: 0, invitations: 0 },
  ];
  readonly runLimits: number[] = [];
  readonly deliveryLimits: number[] = [];
  readonly rateLimitLimits: number[] = [];
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

  async deleteExpiredRateLimits(before: number, limit: number): Promise<number> {
    expect(before).toBe(NOW);
    this.rateLimitLimits.push(limit);
    return this.rateLimitResults.shift() ?? 0;
  }

  async deleteAuthDebris(input: {
    emailBefore: number;
    refreshBefore: number;
    invitationBefore: number;
    adminSessionBefore: number;
    limit: number;
  }): Promise<AuthDebrisCounts> {
    this.authLimits.push(input.limit);
    expect(input).toMatchObject({
      emailBefore: NOW - 7 * DAY_MS,
      refreshBefore: NOW - 30 * DAY_MS,
      invitationBefore: NOW - 30 * DAY_MS,
      adminSessionBefore: NOW,
    });
    return this.authResults.shift() ?? {
      emailTokens: 0,
      refreshTokens: 0,
      invitations: 0,
      adminSessions: 0,
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

class RecordingActivityRepo extends FakeActivityEventRepo {
  readonly cutoffs: number[] = [];
  readonly limits: number[] = [];

  override async deleteOlderThan(
    before: number,
    types: ActivityEventType[],
    limit: number,
  ): Promise<number> {
    if (!this.cutoffs.includes(before)) this.cutoffs.push(before);
    this.limits.push(limit);
    return super.deleteOlderThan(before, types, limit);
  }
}

function activityEvent(
  id: string,
  type: ActivityEventType,
  occurredAt: number,
): ActivityEvent {
  return {
    id,
    type,
    userId: "usr_cleanup",
    workspaceId: type === "user.logged_in" ? null : "ws_cleanup",
    source: "web",
    resourceType: null,
    resourceId: null,
    propertiesJson: null,
    occurredAt,
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
      rateLimits: 201,
      tokens: 804,
      activityEvents: 0,
    });
    expect(cleanup.runLimits).toEqual([200, 200, 200]);
    expect(cleanup.deliveryLimits).toEqual([200, 200, 200]);
    expect(cleanup.rateLimitLimits).toEqual([200, 200, 200]);
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

  it("purges activity events past their per-volume retention", async () => {
    const activity = new RecordingActivityRepo();
    for (const event of [
      activityEvent("act_view_old", "web.page_viewed", NOW - 91 * DAY_MS),
      activityEvent("act_view_recent", "web.page_viewed", NOW - 89 * DAY_MS),
      activityEvent("act_login_old", "user.logged_in", NOW - 366 * DAY_MS),
      activityEvent("act_login_recent", "user.logged_in", NOW - 364 * DAY_MS),
    ]) {
      await activity.insert(event);
    }
    const logs: { event: string; fields: object | undefined }[] = [];
    const purge = new PurgeExpired(
      new ScriptedCleanupRepo(),
      new FakeArtifactRepo(),
      new FakeCheckRepo(),
      new RecordingStorage(),
      new FixedClock(NOW),
      (event, fields) => logs.push({ event, fields }),
      activity,
    );

    const result = await purge.execute();

    expect(result.activityEvents).toBe(2);
    expect(activity.events.map((event) => event.id).sort()).toEqual([
      "act_login_recent",
      "act_view_recent",
    ]);
    expect(activity.cutoffs).toEqual([NOW - 90 * DAY_MS, NOW - 365 * DAY_MS]);
    // One draining loop per volume: a deleting call followed by the empty one.
    expect(activity.limits).toEqual([200, 200, 200, 200]);
    expect(logs).toEqual([{ event: "cleanup", fields: result }]);
  });

  it("drains expired activity events in bounded batches", async () => {
    const activity = new RecordingActivityRepo();
    for (let index = 0; index < 201; index += 1) {
      await activity.insert(
        activityEvent(
          `act_old_${index}`,
          "browser_test.run_passed",
          NOW - 91 * DAY_MS - index,
        ),
      );
    }
    const purge = new PurgeExpired(
      new ScriptedCleanupRepo(),
      new FakeArtifactRepo(),
      new FakeCheckRepo(),
      new RecordingStorage(),
      new FixedClock(NOW),
      () => undefined,
      activity,
    );

    const result = await purge.execute();

    expect(result.activityEvents).toBe(201);
    expect(activity.events).toHaveLength(0);
    expect(activity.limits).toEqual([200, 200, 200, 200]);
  });
});
