import type { TestRun } from "../../domain/browser_tests/types";
import { createDurableJob, createOutboxEntry } from "../../application/durability/factory";
import { freshDb, testEnv } from "../../test/helpers";
import { FakeIds } from "../../test/fakes/ids";
import { D1DurableWorkflowRepo } from "./durable_workflow_repo";
import { D1RunRepo } from "./run_repo";

const NOW = 1_800_000_000_000;

function queuedRun(id: string): TestRun {
  return {
    id,
    workspaceId: "ws_durable",
    browserTestId: null,
    source: "MANUAL",
    status: "QUEUED",
    snapshot: {
      name: "Durability fixture",
      startUrl: "https://example.com",
      instructions: "Check it",
      device: "DESKTOP",
      intervalHours: 1,
      maxRetries: 0,
      notifyOnRecovery: true,
      channelIds: [],
      viewport: { width: 1280, height: 720 },
      modelName: "gpt-5-mini",
      runnerVersion: "test",
    },
    scheduledFor: null,
    queuedAt: NOW,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    attemptCount: 1,
    infraAttempts: 0,
    passedAfterRetry: false,
    billable: true,
    usageEventId: null,
    triggeredByUserId: "usr_durable",
    incidentId: null,
    createdAt: NOW,
  };
}

describe("D1DurableWorkflowRepo recovery", () => {
  beforeEach(freshDb);

  it("quarantines poison ahead of the limit and still returns later valid work", async () => {
    const database = testEnv().DB;
    const repo = new D1DurableWorkflowRepo(database);
    const runValue = queuedRun("run_valid_durable");
    await new D1RunRepo(database).insert(runValue);
    await database.batch([
      database
        .prepare(
          `INSERT INTO durable_jobs
            (id, kind, aggregate_key, payload_json, status, created_at,
             updated_at, completed_at)
           VALUES (?, 'RUN_FINALIZATION', ?, ?, 'PENDING', ?, ?, NULL)`,
        )
        .bind("job_poison", "wrong-aggregate", "{not-json", 1, 1),
      database
        .prepare(
          `INSERT INTO durable_jobs
            (id, kind, aggregate_key, payload_json, status, created_at,
             updated_at, completed_at)
           VALUES (?, 'RUN_FINALIZATION', ?, ?, 'PENDING', ?, ?, NULL)`,
        )
        .bind(
          "job_valid",
          runValue.id,
          JSON.stringify({ runId: runValue.id, reverseUsage: false }),
          2,
          2,
        ),
    ]);
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      repo.listPendingJobs(["RUN_FINALIZATION"], 1),
    ).resolves.toMatchObject([{ id: "job_valid" }]);

    const poison = await database
      .prepare(
        "SELECT quarantined_at, failure_count, last_error FROM durable_jobs WHERE id = ?",
      )
      .bind("job_poison")
      .first<{
        quarantined_at: number | null;
        failure_count: number;
        last_error: string | null;
      }>();
    expect(poison?.quarantined_at).not.toBeNull();
    expect(poison?.failure_count).toBe(1);
    expect(poison?.last_error).toContain("valid JSON");
    alert.mockRestore();
  });

  it("backs off publish failures and removes exhausted poison from pending scans", async () => {
    const repo = new D1DurableWorkflowRepo(testEnv().DB);
    const entry = createOutboxEntry({
      dedupeKey: "itest:failure-backoff",
      queueKind: "RUN",
      payload: {
        kind: "attempt",
        runId: "run_1",
        attemptId: "att_1",
        attemptIndex: 0,
        executionGeneration: NOW,
      },
      availableAt: NOW,
      now: NOW,
      ids: new FakeIds(),
    });
    await repo.insertOutbox(entry);

    await expect(
      repo.recordOutboxFailure(entry.id, NOW, "queue unavailable"),
    ).resolves.toBe("retry");
    await expect(
      repo.recordOutboxFailure(entry.id, NOW, "queue unavailable"),
    ).resolves.toBe("retry");
    const backedOff = await testEnv()
      .DB.prepare(
        "SELECT available_at FROM queue_outbox WHERE id = ?",
      )
      .bind(entry.id)
      .first<{ available_at: number }>();
    expect(backedOff?.available_at).toBe(NOW + 30_000);

    for (let count = 3; count <= 7; count += 1) {
      await expect(
        repo.recordOutboxFailure(entry.id, NOW, "queue unavailable"),
      ).resolves.toBe("retry");
    }
    await expect(
      repo.recordOutboxFailure(entry.id, NOW, "queue unavailable"),
    ).resolves.toBe("quarantined");
    await expect(
      repo.listPending(1, NOW + 1_000_000, NOW),
    ).resolves.toEqual([]);
  });
});
