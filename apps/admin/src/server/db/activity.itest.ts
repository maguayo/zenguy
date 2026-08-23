import { env } from "cloudflare:test";
import { loadActivityFeed } from "./activity";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const USER_ONE = "usr_00000000000000000000000001";
const USER_TWO = "usr_00000000000000000000000002";
const MISSING_USER = "usr_00000000000000000000000003";

const TABLES = ["activity_events", "workspace_members", "workspaces", "users"] as const;

type Source = "web" | "app" | "api" | "server";

interface EventSeed {
  id: string;
  type: string;
  userId: string | null;
  workspaceId: string | null;
  source: Source;
  resourceType?: string;
  resourceId?: string;
  properties?: string;
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

function insertEvent(event: EventSeed): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO activity_events
       (id, type, user_id, workspace_id, source, resource_type, resource_id,
        properties_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    event.id,
    event.type,
    event.userId,
    event.workspaceId,
    event.source,
    event.resourceType ?? null,
    event.resourceId ?? null,
    event.properties ?? null,
    event.occurredAt,
  );
}

async function seed(): Promise<void> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await env.DB.batch([
    insertUser(USER_ONE, "One", "one@example.com"),
    insertUser(USER_TWO, "Two", "two@example.com"),
    env.DB.prepare(
      `INSERT INTO workspaces (id, name, slug, timezone, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind("ws_acme", "Acme", "acme", "UTC", USER_ONE, NOW - 2 * DAY, NOW),
    insertEvent({
      id: "act_login",
      type: "user.logged_in",
      userId: USER_ONE,
      workspaceId: null,
      source: "web",
      occurredAt: NOW - 6 * HOUR,
    }),
    insertEvent({
      id: "act_page",
      type: "web.page_viewed",
      userId: USER_ONE,
      workspaceId: "ws_acme",
      source: "web",
      properties: JSON.stringify({ route: "/tests" }),
      occurredAt: NOW - 2 * HOUR,
    }),
    insertEvent({
      id: "act_screen",
      type: "app.screen_viewed",
      userId: USER_TWO,
      workspaceId: "ws_acme",
      source: "app",
      properties: JSON.stringify({ screen: "/(tabs)/tests" }),
      occurredAt: NOW - 4 * HOUR,
    }),
    // Same instant: the tie breaks on id, descending.
    insertEvent({
      id: "act_tie_a",
      type: "run.viewed",
      userId: USER_TWO,
      workspaceId: "ws_acme",
      source: "app",
      resourceType: "run",
      resourceId: "run_pass",
      occurredAt: NOW - 3 * HOUR,
    }),
    insertEvent({
      id: "act_tie_b",
      type: "run.viewed",
      userId: USER_TWO,
      workspaceId: "ws_acme",
      source: "app",
      resourceType: "run",
      resourceId: "run_fail",
      occurredAt: NOW - 3 * HOUR,
    }),
    insertEvent({
      id: "act_test_created",
      type: "browser_test.created",
      userId: USER_ONE,
      workspaceId: "ws_acme",
      source: "web",
      resourceType: "browser_test",
      resourceId: "bt_home",
      properties: JSON.stringify({ name: "Homepage" }),
      occurredAt: NOW - DAY,
    }),
    insertEvent({
      id: "act_run_failed",
      type: "browser_test.run_failed",
      userId: null,
      workspaceId: "ws_acme",
      source: "server",
      resourceType: "browser_test",
      resourceId: "bt_home",
      properties: JSON.stringify({ runId: "run_fail", status: "FAILED" }),
      occurredAt: NOW - HOUR,
    }),
    insertEvent({
      id: "act_alert",
      type: "alert.sent",
      userId: null,
      workspaceId: "ws_acme",
      source: "server",
      resourceType: "notification_delivery",
      resourceId: "nd_1",
      properties: JSON.stringify({ channelType: "EMAIL" }),
      occurredAt: NOW - 50 * MINUTE,
    }),
    insertEvent({
      id: "act_incident",
      type: "incident.opened",
      userId: null,
      workspaceId: "ws_acme",
      source: "server",
      resourceType: "incident",
      resourceId: "inc_1",
      properties: JSON.stringify({ monitorId: "mon_api" }),
      occurredAt: NOW - 10 * MINUTE,
    }),
    // Actor and workspace that no longer exist: the row is still listed.
    insertEvent({
      id: "act_orphan",
      type: "web.page_viewed",
      userId: MISSING_USER,
      workspaceId: "ws_missing",
      source: "web",
      occurredAt: NOW - 5 * MINUTE,
    }),
  ]);
}

async function loadListed(limit: number, type: string | null) {
  const response = await loadActivityFeed(env.DB, limit, type);
  if ("unavailable" in response) throw new Error("expected the activity payload");
  return response.events;
}

describe("loadActivityFeed", () => {
  beforeEach(seed);
  afterEach(restoreActivitySchema);

  it("lists the newest events first with actor, workspace and properties resolved", async () => {
    const events = await loadListed(50, null);

    expect(events.map((event) => event.id)).toEqual([
      "act_orphan",
      "act_incident",
      "act_alert",
      "act_run_failed",
      "act_page",
      "act_tie_b",
      "act_tie_a",
      "act_screen",
      "act_login",
      "act_test_created",
    ]);
    expect(events[4]).toEqual({
      id: "act_page",
      type: "web.page_viewed",
      occurredAt: NOW - 2 * HOUR,
      source: "web",
      actor: { id: USER_ONE, name: "One", email: "one@example.com" },
      workspace: { id: "ws_acme", name: "Acme" },
      resourceType: null,
      resourceId: null,
      properties: { route: "/tests" },
    });
    expect(events[1]).toEqual({
      id: "act_incident",
      type: "incident.opened",
      occurredAt: NOW - 10 * MINUTE,
      source: "server",
      actor: null,
      workspace: { id: "ws_acme", name: "Acme" },
      resourceType: "incident",
      resourceId: "inc_1",
      properties: { monitorId: "mon_api" },
    });
    expect(events[8]).toMatchObject({
      id: "act_login",
      actor: { id: USER_ONE, name: "One", email: "one@example.com" },
      workspace: null,
      properties: null,
    });
    expect(events[0]).toMatchObject({ id: "act_orphan", actor: null, workspace: null });
  });

  it("returns null properties when the stored JSON is not parseable", async () => {
    await insertEvent({
      id: "act_broken",
      type: "web.page_viewed",
      userId: USER_ONE,
      workspaceId: "ws_acme",
      source: "web",
      properties: "{not json",
      occurredAt: NOW - MINUTE,
    }).run();

    const events = await loadListed(1, null);
    expect(events[0]).toMatchObject({ id: "act_broken", properties: null });
  });

  it("filters by type", async () => {
    const alerts = await loadListed(50, "alert.sent");
    expect(alerts.map((event) => event.id)).toEqual(["act_alert"]);
    expect(alerts[0]).toMatchObject({
      resourceType: "notification_delivery",
      resourceId: "nd_1",
      properties: { channelType: "EMAIL" },
    });

    await expect(loadListed(50, "user.registered")).resolves.toEqual([]);
  });

  it("honours the limit", async () => {
    const events = await loadListed(2, null);
    expect(events.map((event) => event.id)).toEqual(["act_orphan", "act_incident"]);
  });

  it("degrades to MIGRATION_PENDING while 0038 has not reached the database", async () => {
    await env.DB.exec("DROP TABLE activity_events");

    await expect(loadActivityFeed(env.DB, 50, null)).resolves.toEqual({
      unavailable: "MIGRATION_PENDING",
    });
  });
});
