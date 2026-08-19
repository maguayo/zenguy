import { freshDb, testEnv } from "../../test/helpers";
import { all } from "./d1";

const TABLES = [
  "browser_tests",
  "browser_test_channels",
  "test_runs",
  "test_attempts",
  "run_steps",
  "run_artifacts",
] as const;

async function insertBrowserTest(id = "bt_1"): Promise<void> {
  await testEnv()
    .DB.prepare(
      `INSERT INTO browser_tests
        (id, workspace_id, name, start_url, instructions, device,
         interval_hours, max_retries, next_run_at, created_at, updated_at)
       VALUES (?, 'ws_1', 'Checkout', 'https://example.com', 'Verify it',
               'DESKTOP', 1, 2, 1000, 1, 1)`,
    )
    .bind(id)
    .run();
}

async function insertRun(input: {
  id: string;
  browserTestId: string | null;
  status: string;
  scheduledFor?: number | null;
}): Promise<void> {
  await testEnv()
    .DB.prepare(
      `INSERT INTO test_runs
        (id, workspace_id, browser_test_id, source, status, snapshot_json,
         scheduled_for, queued_at, created_at)
       VALUES (?, 'ws_1', ?, 'SCHEDULED', ?, '{}', ?, 1, 1)`,
    )
    .bind(
      input.id,
      input.browserTestId,
      input.status,
      input.scheduledFor ?? null,
    )
    .run();
}

describe("browser test migration", () => {
  beforeEach(freshDb);

  it("creates every table and required index", async () => {
    const tables = await all<{ name: string }>(
      testEnv().DB.prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN (${TABLES.map(() => "?").join(",")})
         ORDER BY name`,
      ).bind(...TABLES),
    );
    expect(tables.map(({ name }) => name)).toEqual([...TABLES].sort());

    const indexes = await all<{ name: string }>(
      testEnv().DB.prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name LIKE 'idx_%'
         ORDER BY name`,
      ),
    );
    const names = indexes.map(({ name }) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        "idx_bt_ws",
        "idx_bt_due",
        "idx_runs_ws_time",
        "idx_runs_test_time",
        "idx_runs_active_per_test",
        "idx_runs_occurrence",
        "idx_attempts_run_index",
        "idx_steps_attempt_seq",
        "idx_artifacts_key",
        "idx_artifacts_run",
        "idx_artifacts_expiry",
      ]),
    );
  });

  it("enforces browser/run checks and both partial unique indexes", async () => {
    await insertBrowserTest();
    await expect(
      testEnv().DB.prepare(
        `INSERT INTO browser_tests
          (id, workspace_id, name, start_url, instructions, device,
           interval_hours, max_retries, next_run_at, created_at, updated_at)
         VALUES ('bt_bad', 'ws_1', 'Bad', 'https://example.com', 'Bad',
                 'TABLET', 0, 4, 1, 1, 1)`,
      ).run(),
    ).rejects.toThrow();

    await insertRun({
      id: "run_active",
      browserTestId: "bt_1",
      status: "QUEUED",
      scheduledFor: 100,
    });
    await expect(
      insertRun({
        id: "run_second_active",
        browserTestId: "bt_1",
        status: "RUNNING",
        scheduledFor: 101,
      }),
    ).rejects.toThrow();
    await expect(
      insertRun({
        id: "run_same_occurrence",
        browserTestId: "bt_1",
        status: "PASSED",
        scheduledFor: 100,
      }),
    ).rejects.toThrow();
    await expect(
      insertRun({
        id: "run_finished",
        browserTestId: "bt_1",
        status: "PASSED",
      }),
    ).resolves.toBeUndefined();
    await expect(
      Promise.all([
        insertRun({ id: "run_draft_1", browserTestId: null, status: "QUEUED" }),
        insertRun({ id: "run_draft_2", browserTestId: null, status: "QUEUED" }),
      ]),
    ).resolves.toBeDefined();
  });

  it("freshDb clears every new table", async () => {
    await insertBrowserTest();
    await insertRun({ id: "run_1", browserTestId: "bt_1", status: "PASSED" });
    await testEnv().DB.batch([
      testEnv().DB.prepare(
        "INSERT INTO browser_test_channels (browser_test_id, notification_channel_id) VALUES ('bt_1', 'ch_1')",
      ),
      testEnv().DB.prepare(
        `INSERT INTO test_attempts
          (id, test_run_id, attempt_index, status, queued_at, created_at)
         VALUES ('att_1', 'run_1', 0, 'PASSED', 1, 1)`,
      ),
      testEnv().DB.prepare(
        `INSERT INTO run_steps
          (id, attempt_id, sequence, timestamp, action_type, description,
           result, created_at)
         VALUES ('step_1', 'att_1', 1, 1, 'navigate', 'Opened page', 'OK', 1)`,
      ),
      testEnv().DB.prepare(
        `INSERT INTO run_artifacts
          (id, workspace_id, run_id, attempt_id, type, storage_key,
           mime_type, created_at, expires_at)
         VALUES ('art_1', 'ws_1', 'run_1', 'att_1', 'SCREENSHOT',
                 'runs/run_1/screenshot.png', 'image/png', 1, 2)`,
      ),
    ]);

    await freshDb();

    for (const table of TABLES) {
      const row = await testEnv()
        .DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .first<{ count: number }>();
      expect(row?.count, table).toBe(0);
    }
  });
});
