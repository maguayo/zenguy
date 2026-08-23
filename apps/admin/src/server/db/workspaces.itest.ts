import { env } from "cloudflare:test";
import { loadWorkspaces } from "./workspaces";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const TABLES = ["activity_events", "workspace_members", "workspaces", "users"] as const;

type Source = "web" | "app" | "api" | "server";

interface EventSeed {
  id: string;
  type: string;
  userId: string | null;
  workspaceId: string | null;
  source: Source;
  occurredAt: number;
}

// The 0038 DDL, inlined so the MIGRATION_PENDING test can put the table back.
const ACTIVITY_DDL = [
  `CREATE TABLE IF NOT EXISTS activity_events (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     user_id TEXT,
     workspace_id TEXT,
     source TEXT NOT NULL CHECK (source IN ('web','app','api','server')),
     resource_type TEXT,
     resource_id TEXT,
     properties_json TEXT,
     occurred_at INTEGER NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS idx_activity_ws_time ON activity_events (workspace_id, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activity_ws_type_time ON activity_events (workspace_id, type, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activity_user_time ON activity_events (user_id, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_events (occurred_at DESC)",
];

/** Re-creates whatever the MIGRATION_PENDING test dropped (0038). */
async function restoreActivitySchema(): Promise<void> {
  for (const statement of ACTIVITY_DDL) await env.DB.exec(statement.replace(/\s+/gu, " "));
}

function insertUser(id: string, name: string, email: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, email_verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, name, email, "hash", NOW - 2 * DAY, NOW - 2 * DAY, NOW);
}

function insertWorkspace(
  id: string,
  name: string,
  ownerUserId: string,
  createdAt: number,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO workspaces (id, name, slug, timezone, owner_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, name, name.toLowerCase(), "UTC", ownerUserId, createdAt, NOW);
}

function insertMember(
  id: string,
  workspaceId: string,
  userId: string,
  role: "OWNER" | "MEMBER",
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(id, workspaceId, userId, role, NOW - 2 * DAY);
}

function insertEvent(event: EventSeed): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO activity_events
       (id, type, user_id, workspace_id, source, resource_type, resource_id,
        properties_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
  ).bind(
    event.id,
    event.type,
    event.userId,
    event.workspaceId,
    event.source,
    event.occurredAt,
  );
}

/**
 * Tombstones a workspace. The deployed schema only has `deleted_at`; the
 * deletion-saga migration (0029) adds `deletion_state`, which is kept
 * consistent when present so the row looks like a real completed deletion.
 */
async function tombstone(id: string, at: number): Promise<D1PreparedStatement> {
  const columns = await env.DB.prepare("PRAGMA table_info(workspaces)").all<{ name: string }>();
  const hasSaga = columns.results.some((column) => column.name === "deletion_state");
  return hasSaga
    ? env.DB.prepare(
        `UPDATE workspaces
         SET deleted_at = ?, deletion_state = 'COMPLETED', deletion_completed_at = ?
         WHERE id = ?`,
      ).bind(at, at, id)
    : env.DB.prepare("UPDATE workspaces SET deleted_at = ? WHERE id = ?").bind(at, id);
}

async function seed(): Promise<void> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  const tombstoneGone = await tombstone("ws_gone", NOW - DAY);
  await env.DB.batch([
    insertUser("usr_one", "One", "one@example.com"),
    insertUser("usr_two", "Two", "two@example.com"),
    // Never a member of a live workspace: its login must not leak into ws_acme.
    insertUser("usr_three", "Three", "three@example.com"),
    insertWorkspace("ws_acme", "Acme", "usr_one", NOW - 2 * DAY),
    insertWorkspace("ws_gone", "Former", "usr_one", NOW - 40 * DAY),
    insertMember("wm_one", "ws_acme", "usr_one", "OWNER"),
    insertMember("wm_two", "ws_acme", "usr_two", "MEMBER"),
    insertMember("wm_gone", "ws_gone", "usr_one", "OWNER"),
    // Tombstoned after its member row: 0029 fences member inserts on deleted workspaces.
    tombstoneGone,
    // Logins carry no workspace; they reach a workspace through its members.
    insertEvent({
      id: "act_login_one",
      type: "user.logged_in",
      userId: "usr_one",
      workspaceId: null,
      source: "web",
      occurredAt: NOW - 6 * HOUR,
    }),
    insertEvent({
      id: "act_login_two",
      type: "user.logged_in",
      userId: "usr_two",
      workspaceId: null,
      source: "app",
      occurredAt: NOW - 3 * HOUR,
    }),
    insertEvent({
      id: "act_login_three",
      type: "user.logged_in",
      userId: "usr_three",
      workspaceId: null,
      source: "web",
      occurredAt: NOW - MINUTE,
    }),
    insertEvent({
      id: "act_page",
      type: "web.page_viewed",
      userId: "usr_one",
      workspaceId: "ws_acme",
      source: "web",
      occurredAt: NOW - 2 * HOUR,
    }),
    insertEvent({
      id: "act_screen",
      type: "app.screen_viewed",
      userId: "usr_two",
      workspaceId: "ws_acme",
      source: "app",
      occurredAt: NOW - 4 * HOUR,
    }),
    insertEvent({
      id: "act_test_created",
      type: "browser_test.created",
      userId: "usr_one",
      workspaceId: "ws_acme",
      source: "web",
      occurredAt: NOW - DAY,
    }),
    insertEvent({
      id: "act_run_passed",
      type: "browser_test.run_passed",
      userId: null,
      workspaceId: "ws_acme",
      source: "server",
      occurredAt: NOW - 5 * HOUR,
    }),
    insertEvent({
      id: "act_run_failed",
      type: "browser_test.run_failed",
      userId: null,
      workspaceId: "ws_acme",
      source: "server",
      occurredAt: NOW - HOUR,
    }),
    insertEvent({
      id: "act_alert",
      type: "alert.sent",
      userId: null,
      workspaceId: "ws_acme",
      source: "server",
      occurredAt: NOW - 50 * MINUTE,
    }),
    // Newest row of the workspace, but system-originated: not "activity".
    insertEvent({
      id: "act_incident",
      type: "incident.opened",
      userId: null,
      workspaceId: "ws_acme",
      source: "server",
      occurredAt: NOW - 10 * MINUTE,
    }),
    // Activity of the deleted workspace must not resurrect it.
    insertEvent({
      id: "act_gone_page",
      type: "web.page_viewed",
      userId: "usr_one",
      workspaceId: "ws_gone",
      source: "web",
      occurredAt: NOW - 5 * MINUTE,
    }),
  ]);
}

async function loadListed() {
  const response = await loadWorkspaces(env.DB, 50);
  if ("unavailable" in response) throw new Error("expected the workspaces payload");
  return response.workspaces;
}

describe("loadWorkspaces", () => {
  beforeEach(seed);
  afterEach(restoreActivitySchema);

  it("summarises each live workspace with the last time it did something", async () => {
    const workspaces = await loadListed();

    expect(workspaces).toEqual([
      {
        id: "ws_acme",
        name: "Acme",
        slug: "acme",
        ownerEmail: "one@example.com",
        memberCount: 2,
        createdAt: NOW - 2 * DAY,
        // incident.opened is newer but has no user behind it.
        lastActiveAt: NOW - 2 * HOUR,
        lastWebAt: NOW - 2 * HOUR,
        lastAppAt: NOW - 4 * HOUR,
        // usr_two's login: members count, usr_three does not.
        lastLoginAt: NOW - 3 * HOUR,
        lastTestCreatedAt: NOW - DAY,
        lastRunAt: NOW - HOUR,
        lastRunStatus: "FAILED",
        lastAlertSentAt: NOW - 50 * MINUTE,
      },
    ]);
  });

  it("maps the newest run outcome onto a run status", async () => {
    await insertEvent({
      id: "act_run_timeout",
      type: "browser_test.run_timed_out",
      userId: null,
      workspaceId: "ws_acme",
      source: "server",
      occurredAt: NOW - 30 * MINUTE,
    }).run();
    expect((await loadListed())[0]).toMatchObject({
      lastRunAt: NOW - 30 * MINUTE,
      lastRunStatus: "TIMEOUT",
    });

    await insertEvent({
      id: "act_run_errored",
      type: "browser_test.run_errored",
      userId: null,
      workspaceId: "ws_acme",
      source: "server",
      occurredAt: NOW - 20 * MINUTE,
    }).run();
    expect((await loadListed())[0]).toMatchObject({
      lastRunAt: NOW - 20 * MINUTE,
      lastRunStatus: "SYSTEM_ERROR",
    });
  });

  it("orders by last activity with idle workspaces last, and honours the limit", async () => {
    await env.DB.batch([
      insertWorkspace("ws_busy", "Busy", "usr_two", NOW - 3 * DAY),
      insertMember("wm_busy", "ws_busy", "usr_two", "OWNER"),
      insertEvent({
        id: "act_busy_view",
        type: "browser_test.viewed",
        userId: "usr_two",
        workspaceId: "ws_busy",
        source: "app",
        occurredAt: NOW - MINUTE,
      }),
      // No members, no events, and an owner that no longer exists.
      insertWorkspace("ws_idle", "Idle", "usr_missing", NOW - DAY),
    ]);

    const workspaces = await loadListed();
    expect(workspaces.map((workspace) => workspace.id)).toEqual([
      "ws_busy",
      "ws_acme",
      "ws_idle",
    ]);
    expect(workspaces[0]).toMatchObject({
      ownerEmail: "two@example.com",
      memberCount: 1,
      lastActiveAt: NOW - MINUTE,
      lastWebAt: null,
      lastAppAt: NOW - MINUTE,
      lastLoginAt: NOW - 3 * HOUR,
      lastTestCreatedAt: null,
      lastRunAt: null,
      lastRunStatus: null,
      lastAlertSentAt: null,
    });
    expect(workspaces[2]).toEqual({
      id: "ws_idle",
      name: "Idle",
      slug: "idle",
      ownerEmail: null,
      memberCount: 0,
      createdAt: NOW - DAY,
      lastActiveAt: null,
      lastWebAt: null,
      lastAppAt: null,
      lastLoginAt: null,
      lastTestCreatedAt: null,
      lastRunAt: null,
      lastRunStatus: null,
      lastAlertSentAt: null,
    });

    const limited = await loadWorkspaces(env.DB, 1);
    if ("unavailable" in limited) throw new Error("expected the workspaces payload");
    expect(limited.workspaces.map((workspace) => workspace.id)).toEqual(["ws_busy"]);
  });

  it("degrades to MIGRATION_PENDING while 0038 has not reached the database", async () => {
    await env.DB.exec("DROP TABLE activity_events");

    await expect(loadWorkspaces(env.DB, 50)).resolves.toEqual({
      unavailable: "MIGRATION_PENDING",
    });
  });
});
