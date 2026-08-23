import { env } from "cloudflare:test";
import { loadWorkers } from "./workers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_700_000_000_000;

const TABLES = [
  "test_attempts",
  "test_runs",
  "workspaces",
  "runner_workers",
] as const;

const ATTEMPT_COLUMNS: Record<string, string> = {
  // 0021
  input_tokens: "ALTER TABLE test_attempts ADD COLUMN input_tokens INTEGER",
  output_tokens: "ALTER TABLE test_attempts ADD COLUMN output_tokens INTEGER",
};

/** The database outlives this file, so put back whatever a test dropped. */
async function restoreAttemptSchema(): Promise<void> {
  const columns = await env.DB.prepare(
    "SELECT name FROM pragma_table_info('test_attempts')",
  ).all<{ name: string }>();
  const present = new Set(columns.results.map((column) => column.name));
  for (const [column, statement] of Object.entries(ATTEMPT_COLUMNS)) {
    if (!present.has(column)) await env.DB.exec(statement);
  }
}

function worker(id: string, mode: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO runner_workers (id, mode, version, started_at, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, mode, "1.2.0", NOW - 8 * DAY, NOW - 8 * DAY, NOW - 3_000);
}

function run(id: string, createdAt: number): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO test_runs
       (id, workspace_id, browser_test_id, source, status, snapshot_json, queued_at,
        started_at, finished_at, duration_ms, attempt_count, passed_after_retry, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    "ws_acme",
    null,
    "MANUAL",
    "PASSED",
    JSON.stringify({ name: "Homepage" }),
    createdAt,
    createdAt,
    createdAt + 1_000,
    1_000,
    1,
    0,
    createdAt,
  );
}

function attempt(
  id: string,
  runId: string,
  runnerId: string,
  createdAt: number,
  inputTokens: number,
  outputTokens: number,
  index = 0,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO test_attempts
       (id, test_run_id, attempt_index, status, queued_at, started_at, finished_at,
        duration_ms, claimed_by_runner_id, runner_kind, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    runId,
    index,
    "PASSED",
    createdAt,
    createdAt,
    createdAt + 1_000,
    1_000,
    runnerId,
    "primary",
    inputTokens,
    outputTokens,
    createdAt,
  );
}

async function seed(): Promise<void> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO workspaces (id, name, slug, timezone, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind("ws_acme", "Acme", "acme", "UTC", "usr_one", NOW - 9 * DAY, NOW),
    worker("vps-1", "fallback"),
    worker("mac-1", "local"),
    // Never claimed anything: its counters must be zero, not missing.
    worker("mac-2", "local"),
    run("run_recent", NOW - 2 * HOUR),
    run("run_yesterday", NOW - 30 * HOUR),
    run("run_stale", NOW - 8 * DAY),
    run("run_mac", NOW - HOUR),
    run("run_unclaimed", NOW - 3 * HOUR),
    attempt("att_recent", "run_recent", "vps-1", NOW - 2 * HOUR, 100, 50),
    // Inside the 7 d window, outside the 24 h one.
    attempt("att_yesterday", "run_yesterday", "vps-1", NOW - 30 * HOUR, 900, 900),
    // A retry claimed two hours ago on that same 30 h old run: the windows key
    // off the run, so it adds nothing at all — run_yesterday is already counted
    // once in 7 d, and the run itself is outside the 24 h window.
    attempt("att_retry", "run_yesterday", "vps-1", NOW - 2 * HOUR, 400, 100, 1),
    // Older than 7 d: outside both windows.
    attempt("att_stale", "run_stale", "vps-1", NOW - 8 * DAY, 5_000, 5_000),
    attempt("att_mac", "run_mac", "mac-1", NOW - HOUR, 10, 5),
    env.DB.prepare(
      `INSERT INTO test_attempts
         (id, test_run_id, attempt_index, status, queued_at, claimed_by_runner_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind("att_unclaimed", "run_unclaimed", 0, "QUEUED", NOW - 3 * HOUR, null, NOW - 3 * HOUR),
  ]);
}

describe("admin worker run statistics", () => {
  beforeEach(seed);
  afterEach(restoreAttemptSchema);

  it("counts the distinct runs each worker claimed in the last 24 h and 7 d", async () => {
    const workers = await loadWorkers(env.DB, NOW);
    if ("unavailable" in workers) throw new Error("expected the workers payload");

    const byId = new Map(workers.workers.map((entry) => [entry.id, entry]));
    // Three attempts over two runs inside the 7 d window: the counter is runs.
    expect(byId.get("vps-1")).toMatchObject({
      runs24h: 1,
      runs7d: 2,
      tokens24h: 150,
    });
    expect(byId.get("mac-1")).toMatchObject({
      runs24h: 1,
      runs7d: 1,
      tokens24h: 15,
    });
    expect(byId.get("mac-2")).toMatchObject({
      runs24h: 0,
      runs7d: 0,
      tokens24h: 0,
    });
  });

  it("keeps listing workers with zeroed counters while 0021 is missing", async () => {
    await env.DB.exec("ALTER TABLE test_attempts DROP COLUMN input_tokens");
    await env.DB.exec("ALTER TABLE test_attempts DROP COLUMN output_tokens");

    const workers = await loadWorkers(env.DB, NOW);
    if ("unavailable" in workers) throw new Error("expected the workers payload");

    expect(workers.workers).toHaveLength(3);
    for (const entry of workers.workers) {
      expect(entry).toMatchObject({ runs24h: 0, runs7d: 0, tokens24h: 0 });
    }
  });
});
