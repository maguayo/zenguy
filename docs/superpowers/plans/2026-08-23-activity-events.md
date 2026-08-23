# Activity Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record internal activity events (visits, auth, mutations, executions, incidents, alerts) for every authenticated user so the admin can answer "when was the last time workspace/user X did Y".

**Architecture:** A new append-only `activity_events` table in the API's D1 database, fed (a) by a bridge inside `WriteAudit` for every audited mutation, (b) by explicit `track.execute` calls for non-audited facts, and (c) by a batched `POST /api/me/events` endpoint that the SPA and the iOS app call fire-and-forget with page/screen visits. The admin reads the table directly with new server-side loaders; retention is enforced by the daily purge cron.

**Tech Stack:** Cloudflare Workers + Hono + D1 (`apps/api`), React + react-router v7 + Vite (`apps/frontend`), Expo + expo-router 57 (`apps/app`), Hono Worker (`apps/admin`). Tests: vitest (api, frontend, admin; `globals: true` in api/admin, explicit imports in frontend), `@cloudflare/vitest-pool-workers` for `*.itest.ts`, jest-expo for the app.

**Spec:** `docs/superpowers/specs/2026-08-23-activity-events-design.md`

## Global Constraints

- Event type strings follow `<subject>.<verb_past_tense>` in snake_case; the catalog in `apps/api/src/domain/activity/catalog.ts` is the only source of truth. Clients send strings; the server drops unknown ones.
- `source` is one of `web | app | api | server`. Timestamps are always the server clock (`occurred_at`, epoch ms).
- `user_id` is NULL only for system-originated facts; no event is ever emitted from public/unauthenticated surfaces (website, landing, sign-in/up, forgot/reset, public invitation/grant pages).
- `properties_json` is sanitized with `sanitizeAuditMetadata` and truncated to 2000 characters. Never store IPs, user agents, query strings, concrete paths with ids, or secret values.
- Retention: `volume: "high"` types 90 days, `volume: "normal"` 365 days. Activity events of a deleted workspace are deleted (not anonymized).
- `POST /api/me/events`: 1–25 events per batch, `RATE_LIMITS.events = { limit: 60, windowSeconds: 60 }` per user, membership checked per workspace, non-member/unknown-type/server-only events are dropped silently and counted in `dropped`.
- `track` is an **optional** dependency (`track?: Pick<TrackEvent, "execute">`) everywhere it is injected, matching the repo's existing optional-collaborator pattern (`workspaceOperational?`, `defaultChannels = null`). Calls use `this.track?.execute(...)` / `this.dependencies.track?.execute(...)`. Wiring is enforced by `activity_wiring.test.ts` and by end-to-end itests, not by the type system.
- UI copy stays in English. Code comments in English. No new third-party dependencies.
- Existing files are modified only with minimal, localized `Edit` hunks (never rewrite a whole existing file with `Write`); re-read a file right before editing it because other sessions are editing this tree concurrently. **Do not run `git commit`** from any task — the session owner commits at the end.
- Test commands: API unit `pnpm --filter @zenguy/api test -- <path>`, API integration `pnpm --filter @zenguy/api test:integration -- <path>`, API typecheck `pnpm --filter @zenguy/api typecheck`; frontend `pnpm --filter @zenguy/frontend test -- <path>` and `typecheck`; admin `pnpm --filter @zenguy/admin test -- <path>`, `test:integration -- <path>`, `typecheck`; app `pnpm --dir apps/app test -- <path>` and `pnpm --dir apps/app typecheck`.

## File ownership and parallelism

Tasks in the same wave run concurrently and never touch the same file. A task only edits the files listed under its own **Files**.

| Wave | Tasks | Notes |
| --- | --- | --- |
| 0 | 1 | domain only |
| 1 | 2, 3 | after 1 |
| 2 | 4, 5, 6, 7, 8, 9, 11 (API) · 12 (admin) · 15 (frontend) · 17 (app) | after 2 and 3 (admin 12 needs the migration from 2; 15/17 are independent) |
| 3 | 10 (API wiring + gate) · 13 (admin route) · 16 (frontend integration) · 18 (app integration) | 10 after all wave-2 API tasks; 13 after 12; 16 after 15; 18 after 17 |
| 4 | 19 (review + fix) | after everything |

Shared files and their single owner: `apps/api/src/app.ts` → Task 9 (repo + mount) then Task 10 (track wiring); `apps/api/src/index.ts` → Task 10; `apps/api/src/shared/constants.ts` → Task 9; `apps/api/src/shared/ids.ts` → Task 2; `apps/api/src/test/helpers.ts` → Task 2; `apps/api/src/test/fakes/activity.ts` → Task 3 (creates), read-only for everyone else; `apps/api/src/http/routes/browser_tests.ts`, `uptime.ts`, `alerts.ts`, `billing.ts`, `push_devices.ts`, `public_api.ts` → Task 8; `apps/api/src/http/routes/auth.ts` → Task 6; `rbac_matrix.itest.ts`, `cross_tenant.itest.ts` → Task 9; `apps/frontend/src/App.tsx`, `src/lib/api.ts` → Task 16; `apps/app/app/_layout.tsx` → Task 18. Nobody touches `apps/admin/src/client/**` or `apps/admin/src/shared/types.ts` (another session owns them) nor `apps/admin/src/server/db/queries.itest.ts`.

---

### Task 1: Activity domain — types, catalog, repo port

**Files:**
- Create: `apps/api/src/domain/activity/types.ts`
- Create: `apps/api/src/domain/activity/catalog.ts`
- Create: `apps/api/src/domain/activity/repo.ts`
- Test: `apps/api/src/domain/activity/catalog.test.ts`

**Interfaces:**
- Consumes: `AUDIT_ACTIONS`, `AuditAction` from `apps/api/src/domain/audit/actions.ts`.
- Produces: `ActivitySource`, `ActivityEvent`, `ACTIVITY_EVENTS`, `ActivityEventType`, `ActivityEventSpec`, `ACTIVITY_EVENT_SPECS`, `AUDIT_TO_ACTIVITY`, `isActivityEventType(value)`, `activityEventTypesByVolume(volume)`, `CLIENT_ACTIVITY_EVENT_TYPES`, `ActivityEventRepo`.

- [ ] **Step 1: Write the failing catalog test**

```ts
// apps/api/src/domain/activity/catalog.test.ts
import { AUDIT_ACTIONS } from "../audit/actions";
import {
  ACTIVITY_EVENTS,
  ACTIVITY_EVENT_SPECS,
  AUDIT_TO_ACTIVITY,
  CLIENT_ACTIVITY_EVENT_TYPES,
  activityEventTypesByVolume,
  isActivityEventType,
} from "./catalog";

describe("activity catalog", () => {
  it("names every type as <subject>.<past_tense_verb> in snake_case", () => {
    for (const type of Object.values(ACTIVITY_EVENTS)) {
      expect(type).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/u);
    }
  });

  it("declares a spec for every type and nothing else", () => {
    expect(Object.keys(ACTIVITY_EVENT_SPECS).sort()).toEqual(
      Object.values(ACTIVITY_EVENTS).sort(),
    );
  });

  it("maps every audit action to an activity type", () => {
    expect(Object.keys(AUDIT_TO_ACTIVITY).sort()).toEqual(
      Object.values(AUDIT_ACTIONS).sort(),
    );
    expect(AUDIT_TO_ACTIVITY["test.created"]).toBe("browser_test.created");
    expect(AUDIT_TO_ACTIVITY["monitor.created"]).toBe("uptime_monitor.created");
    expect(AUDIT_TO_ACTIVITY["test.run_manual"]).toBe("browser_test.run_requested");
  });

  it("never lets a client send a type that the server emits", () => {
    const bridged = new Set(Object.values(AUDIT_TO_ACTIVITY));
    for (const type of CLIENT_ACTIVITY_EVENT_TYPES) {
      expect(bridged.has(type)).toBe(false);
      expect(ACTIVITY_EVENT_SPECS[type].client).toBe(true);
    }
    expect(CLIENT_ACTIVITY_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "web.page_viewed",
        "app.screen_viewed",
        "app.opened",
        "browser_test.viewed",
        "run.viewed",
        "uptime_monitor.viewed",
        "incident.viewed",
      ]),
    );
    expect(CLIENT_ACTIVITY_EVENT_TYPES).toHaveLength(7);
  });

  it("classifies volume so retention can purge visits first", () => {
    const high = activityEventTypesByVolume("high");
    expect(high).toEqual(
      expect.arrayContaining([
        "web.page_viewed",
        "app.screen_viewed",
        "browser_test.run_passed",
        "alert.sent",
        "api_key.used",
      ]),
    );
    expect(high).not.toContain("browser_test.created");
    expect(activityEventTypesByVolume("normal")).toContain("user.logged_in");
  });

  it("recognises catalog types and rejects strangers", () => {
    expect(isActivityEventType("user.logged_in")).toBe(true);
    expect(isActivityEventType("toString")).toBe(false);
    expect(isActivityEventType("browser_test.deleted_everything")).toBe(false);
  });

  it("requires a workspace for workspace-scoped resources", () => {
    expect(ACTIVITY_EVENT_SPECS["browser_test.viewed"]).toEqual({
      scope: "workspace",
      resourceType: "browser_test",
      client: true,
      volume: "high",
    });
    expect(ACTIVITY_EVENT_SPECS["user.logged_in"].scope).toBe("user");
    expect(ACTIVITY_EVENT_SPECS["web.page_viewed"].scope).toBe("any");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zenguy/api test -- src/domain/activity/catalog.test.ts`
Expected: FAIL — cannot resolve `./catalog`.

- [ ] **Step 3: Write types, catalog and repo port**

```ts
// apps/api/src/domain/activity/types.ts
import type { ActivityEventType } from "./catalog";

export type ActivitySource = "web" | "app" | "api" | "server";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  userId: string | null;
  workspaceId: string | null;
  source: ActivitySource;
  resourceType: string | null;
  resourceId: string | null;
  propertiesJson: string | null;
  occurredAt: number;
}
```

```ts
// apps/api/src/domain/activity/catalog.ts
import { AUDIT_ACTIONS, type AuditAction } from "../audit/actions";

/**
 * Every activity event the platform records. `<subject>.<past tense verb>`.
 * Clients send these strings; the server drops anything not listed here.
 */
export const ACTIVITY_EVENTS = {
  userRegistered: "user.registered",
  userEmailVerified: "user.email_verified",
  userLoggedIn: "user.logged_in",
  userLoggedOut: "user.logged_out",
  userPasswordReset: "user.password_reset",
  webPageViewed: "web.page_viewed",
  appScreenViewed: "app.screen_viewed",
  appOpened: "app.opened",
  browserTestViewed: "browser_test.viewed",
  runViewed: "run.viewed",
  uptimeMonitorViewed: "uptime_monitor.viewed",
  incidentViewed: "incident.viewed",
  workspaceCreated: "workspace.created",
  workspaceUpdated: "workspace.updated",
  workspaceDeleted: "workspace.deleted",
  workspaceOwnershipTransferred: "workspace.ownership_transferred",
  memberInvited: "member.invited",
  memberInvitationRevoked: "member.invitation_revoked",
  memberJoined: "member.joined",
  memberRoleChanged: "member.role_changed",
  memberRemoved: "member.removed",
  browserTestCreated: "browser_test.created",
  browserTestUpdated: "browser_test.updated",
  browserTestDeleted: "browser_test.deleted",
  browserTestRunRequested: "browser_test.run_requested",
  browserTestValidated: "browser_test.validated",
  browserTestImported: "browser_test.imported",
  browserTestExported: "browser_test.exported",
  browserTestRunPassed: "browser_test.run_passed",
  browserTestRunFailed: "browser_test.run_failed",
  browserTestRunTimedOut: "browser_test.run_timed_out",
  browserTestRunErrored: "browser_test.run_errored",
  reportDownloaded: "report.downloaded",
  uptimeMonitorCreated: "uptime_monitor.created",
  uptimeMonitorUpdated: "uptime_monitor.updated",
  uptimeMonitorDeleted: "uptime_monitor.deleted",
  uptimeMonitorTested: "uptime_monitor.tested",
  incidentOpened: "incident.opened",
  incidentResolved: "incident.resolved",
  channelCreated: "channel.created",
  channelUpdated: "channel.updated",
  channelDeleted: "channel.deleted",
  channelTested: "channel.tested",
  alertSent: "alert.sent",
  alertFailed: "alert.failed",
  alertsSettingsUpdated: "alerts.settings_updated",
  alertsTopupStarted: "alerts.topup_started",
  alertsCreditTopup: "alerts.credit_topup",
  alertsCreditAdjusted: "alerts.credit_adjusted",
  secretCreated: "secret.created",
  secretUpdated: "secret.updated",
  secretDeleted: "secret.deleted",
  encryptionRotated: "security.encryption_rotated",
  apiKeyCreated: "api_key.created",
  apiKeyRevoked: "api_key.revoked",
  apiKeyUsed: "api_key.used",
  billingCheckoutStarted: "billing.checkout_started",
  billingSubscriptionUpdated: "billing.subscription_updated",
  billingGrantIssued: "billing.grant_issued",
  billingGrantRedeemed: "billing.grant_redeemed",
  pushDeviceRegistered: "push_device.registered",
} as const;

export type ActivityEventType =
  (typeof ACTIVITY_EVENTS)[keyof typeof ACTIVITY_EVENTS];

export type ActivityScope = "user" | "workspace" | "any";
export type ActivityVolume = "high" | "normal";

export interface ActivityEventSpec {
  /** workspace ⇒ workspaceId required; user ⇒ must be absent; any ⇒ optional. */
  scope: ActivityScope;
  /** Stored as resource_type when the event carries a resourceId. */
  resourceType: string | null;
  /** true ⇒ a client may report it through POST /api/me/events. */
  client: boolean;
  /** high ⇒ purged after 90 days; normal ⇒ after 365 days. */
  volume: ActivityVolume;
}

function spec(
  scope: ActivityScope,
  resourceType: string | null,
  options: { client?: boolean; volume?: ActivityVolume } = {},
): ActivityEventSpec {
  return {
    scope,
    resourceType,
    client: options.client ?? false,
    volume: options.volume ?? "normal",
  };
}

const visit = (resourceType: string | null, scope: ActivityScope = "workspace") =>
  spec(scope, resourceType, { client: true, volume: "high" });

export const ACTIVITY_EVENT_SPECS: Record<ActivityEventType, ActivityEventSpec> = {
  "user.registered": spec("user", null),
  "user.email_verified": spec("user", null),
  "user.logged_in": spec("user", null),
  "user.logged_out": spec("user", null),
  "user.password_reset": spec("any", "user"),
  "web.page_viewed": visit(null, "any"),
  "app.screen_viewed": visit(null, "any"),
  "app.opened": visit(null, "user"),
  "browser_test.viewed": visit("browser_test"),
  "run.viewed": visit("run"),
  "uptime_monitor.viewed": visit("uptime_monitor"),
  "incident.viewed": visit("incident"),
  "workspace.created": spec("workspace", "workspace"),
  "workspace.updated": spec("workspace", "workspace"),
  "workspace.deleted": spec("workspace", "workspace"),
  "workspace.ownership_transferred": spec("workspace", "workspace"),
  "member.invited": spec("workspace", "member"),
  "member.invitation_revoked": spec("workspace", "member"),
  "member.joined": spec("workspace", "member"),
  "member.role_changed": spec("workspace", "member"),
  "member.removed": spec("workspace", "member"),
  "browser_test.created": spec("workspace", "browser_test"),
  "browser_test.updated": spec("workspace", "browser_test"),
  "browser_test.deleted": spec("workspace", "browser_test"),
  "browser_test.run_requested": spec("workspace", "browser_test"),
  "browser_test.validated": spec("workspace", null),
  "browser_test.imported": spec("workspace", null),
  "browser_test.exported": spec("workspace", null),
  "browser_test.run_passed": spec("workspace", "browser_test", { volume: "high" }),
  "browser_test.run_failed": spec("workspace", "browser_test", { volume: "high" }),
  "browser_test.run_timed_out": spec("workspace", "browser_test", { volume: "high" }),
  "browser_test.run_errored": spec("workspace", "browser_test", { volume: "high" }),
  "report.downloaded": spec("workspace", "run"),
  "uptime_monitor.created": spec("workspace", "uptime_monitor"),
  "uptime_monitor.updated": spec("workspace", "uptime_monitor"),
  "uptime_monitor.deleted": spec("workspace", "uptime_monitor"),
  "uptime_monitor.tested": spec("workspace", null),
  "incident.opened": spec("workspace", "incident"),
  "incident.resolved": spec("workspace", "incident"),
  "channel.created": spec("workspace", "channel"),
  "channel.updated": spec("workspace", "channel"),
  "channel.deleted": spec("workspace", "channel"),
  "channel.tested": spec("workspace", "channel"),
  "alert.sent": spec("workspace", "notification_delivery", { volume: "high" }),
  "alert.failed": spec("workspace", "notification_delivery", { volume: "high" }),
  "alerts.settings_updated": spec("workspace", null),
  "alerts.topup_started": spec("workspace", null),
  "alerts.credit_topup": spec("workspace", null),
  "alerts.credit_adjusted": spec("workspace", null),
  "secret.created": spec("workspace", "secret"),
  "secret.updated": spec("workspace", "secret"),
  "secret.deleted": spec("workspace", "secret"),
  "security.encryption_rotated": spec("workspace", null),
  "api_key.created": spec("workspace", "api_key"),
  "api_key.revoked": spec("workspace", "api_key"),
  "api_key.used": spec("workspace", "api_key", { volume: "high" }),
  "billing.checkout_started": spec("workspace", null),
  "billing.subscription_updated": spec("workspace", null),
  "billing.grant_issued": spec("workspace", null),
  "billing.grant_redeemed": spec("workspace", null),
  "push_device.registered": spec("user", "push_device"),
};

/** Audited mutations are bridged into activity by `WriteAudit`; exhaustive by type. */
export const AUDIT_TO_ACTIVITY: Record<AuditAction, ActivityEventType> = {
  [AUDIT_ACTIONS.workspaceCreated]: ACTIVITY_EVENTS.workspaceCreated,
  [AUDIT_ACTIONS.workspaceUpdated]: ACTIVITY_EVENTS.workspaceUpdated,
  [AUDIT_ACTIONS.workspaceDeleted]: ACTIVITY_EVENTS.workspaceDeleted,
  [AUDIT_ACTIONS.workspaceOwnershipTransferred]:
    ACTIVITY_EVENTS.workspaceOwnershipTransferred,
  [AUDIT_ACTIONS.memberInvited]: ACTIVITY_EVENTS.memberInvited,
  [AUDIT_ACTIONS.memberInvitationRevoked]: ACTIVITY_EVENTS.memberInvitationRevoked,
  [AUDIT_ACTIONS.memberJoined]: ACTIVITY_EVENTS.memberJoined,
  [AUDIT_ACTIONS.memberRoleChanged]: ACTIVITY_EVENTS.memberRoleChanged,
  [AUDIT_ACTIONS.memberRemoved]: ACTIVITY_EVENTS.memberRemoved,
  [AUDIT_ACTIONS.secretCreated]: ACTIVITY_EVENTS.secretCreated,
  [AUDIT_ACTIONS.secretUpdated]: ACTIVITY_EVENTS.secretUpdated,
  [AUDIT_ACTIONS.secretDeleted]: ACTIVITY_EVENTS.secretDeleted,
  [AUDIT_ACTIONS.encryptionRotated]: ACTIVITY_EVENTS.encryptionRotated,
  [AUDIT_ACTIONS.channelCreated]: ACTIVITY_EVENTS.channelCreated,
  [AUDIT_ACTIONS.channelUpdated]: ACTIVITY_EVENTS.channelUpdated,
  [AUDIT_ACTIONS.channelDeleted]: ACTIVITY_EVENTS.channelDeleted,
  [AUDIT_ACTIONS.channelTested]: ACTIVITY_EVENTS.channelTested,
  [AUDIT_ACTIONS.testCreated]: ACTIVITY_EVENTS.browserTestCreated,
  [AUDIT_ACTIONS.testUpdated]: ACTIVITY_EVENTS.browserTestUpdated,
  [AUDIT_ACTIONS.testDeleted]: ACTIVITY_EVENTS.browserTestDeleted,
  [AUDIT_ACTIONS.testRunManual]: ACTIVITY_EVENTS.browserTestRunRequested,
  [AUDIT_ACTIONS.monitorCreated]: ACTIVITY_EVENTS.uptimeMonitorCreated,
  [AUDIT_ACTIONS.monitorUpdated]: ACTIVITY_EVENTS.uptimeMonitorUpdated,
  [AUDIT_ACTIONS.monitorDeleted]: ACTIVITY_EVENTS.uptimeMonitorDeleted,
  [AUDIT_ACTIONS.billingSubscriptionUpdated]:
    ACTIVITY_EVENTS.billingSubscriptionUpdated,
  [AUDIT_ACTIONS.billingGrantIssued]: ACTIVITY_EVENTS.billingGrantIssued,
  [AUDIT_ACTIONS.billingGrantRedeemed]: ACTIVITY_EVENTS.billingGrantRedeemed,
  [AUDIT_ACTIONS.alertsSettingsUpdated]: ACTIVITY_EVENTS.alertsSettingsUpdated,
  [AUDIT_ACTIONS.alertsCreditTopup]: ACTIVITY_EVENTS.alertsCreditTopup,
  [AUDIT_ACTIONS.alertsCreditAdjusted]: ACTIVITY_EVENTS.alertsCreditAdjusted,
  [AUDIT_ACTIONS.authPasswordReset]: ACTIVITY_EVENTS.userPasswordReset,
  [AUDIT_ACTIONS.apiKeyCreated]: ACTIVITY_EVENTS.apiKeyCreated,
  [AUDIT_ACTIONS.apiKeyRevoked]: ACTIVITY_EVENTS.apiKeyRevoked,
};

export function isActivityEventType(value: string): value is ActivityEventType {
  return Object.hasOwn(ACTIVITY_EVENT_SPECS, value);
}

export function activityEventTypesByVolume(
  volume: ActivityVolume,
): ActivityEventType[] {
  return (Object.keys(ACTIVITY_EVENT_SPECS) as ActivityEventType[]).filter(
    (type) => ACTIVITY_EVENT_SPECS[type].volume === volume,
  );
}

export const CLIENT_ACTIVITY_EVENT_TYPES: ActivityEventType[] = (
  Object.keys(ACTIVITY_EVENT_SPECS) as ActivityEventType[]
).filter((type) => ACTIVITY_EVENT_SPECS[type].client);
```

```ts
// apps/api/src/domain/activity/repo.ts
import type { ActivityEventType } from "./catalog";
import type { ActivityEvent } from "./types";

export interface ActivityEventRepo {
  insert(event: ActivityEvent): Promise<void>;
  /** One D1 batch; an empty list is a no-op. */
  insertMany(events: ActivityEvent[]): Promise<void>;
  /** Deletes up to `limit` rows of the given types older than `before`; returns the count. */
  deleteOlderThan(
    before: number,
    types: ActivityEventType[],
    limit: number,
  ): Promise<number>;
  /** Newest first. Intended for tests and debugging, not for product features. */
  listRecent(limit: number): Promise<ActivityEvent[]>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @zenguy/api test -- src/domain/activity/catalog.test.ts`
Expected: PASS (7 tests). If `AUDIT_ACTIONS` has gained an action since this plan was written, TypeScript will flag the missing key in `AUDIT_TO_ACTIVITY`; add it with the same naming rules.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @zenguy/api typecheck`
Expected: no errors in `src/domain/activity/*`.

---

### Task 2: Migration, id prefix, D1 repository

**Files:**
- Create: `apps/api/migrations/0037_activity_events.sql`
- Modify: `apps/api/src/shared/ids.ts` (add `activityEvent: "act"` to `ID_PREFIXES`)
- Modify: `apps/api/src/test/helpers.ts` (add `"DELETE FROM activity_events"` to `DELETE_STATEMENTS`, next to `"DELETE FROM audit_logs"`)
- Create: `apps/api/src/infrastructure/db/activity_event_repo.ts`
- Test: `apps/api/src/infrastructure/db/activity_event_repo.itest.ts`

**Interfaces:**
- Consumes: `ActivityEventRepo`, `ActivityEvent`, `ActivityEventType` from Task 1; `all`, `run`, `batch` from `apps/api/src/infrastructure/db/d1.ts`.
- Produces: `D1ActivityEventRepo implements ActivityEventRepo` (constructor `(database: D1Database)`); id prefix `"act"` usable as `ids.newId("act")`.

- [ ] **Step 1: Write the migration**

```sql
-- apps/api/migrations/0037_activity_events.sql
-- Internal activity events (visits, auth, mutations, executions, incidents, alerts).
-- Append-only; purged by the daily retention job; deleted with their workspace.
CREATE TABLE activity_events (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  user_id         TEXT,
  workspace_id    TEXT,
  source          TEXT NOT NULL CHECK (source IN ('web','app','api','server')),
  resource_type   TEXT,
  resource_id     TEXT,
  properties_json TEXT,
  occurred_at     INTEGER NOT NULL
);
CREATE INDEX idx_activity_ws_time      ON activity_events (workspace_id, occurred_at DESC);
CREATE INDEX idx_activity_ws_type_time ON activity_events (workspace_id, type, occurred_at DESC);
CREATE INDEX idx_activity_user_time    ON activity_events (user_id, occurred_at DESC);
CREATE INDEX idx_activity_time         ON activity_events (occurred_at DESC);
```

- [ ] **Step 2: Add the id prefix and the test cleanup statement**

In `apps/api/src/shared/ids.ts`, inside `ID_PREFIXES`, add after `pushDevice: "pd",`:

```ts
  activityEvent: "act",
```

In `apps/api/src/test/helpers.ts`, inside `DELETE_STATEMENTS`, add immediately after the `"DELETE FROM audit_logs",` line:

```ts
  "DELETE FROM activity_events",
```

- [ ] **Step 3: Write the failing repository itest**

```ts
// apps/api/src/infrastructure/db/activity_event_repo.itest.ts
import type { ActivityEvent } from "../../domain/activity/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1ActivityEventRepo } from "./activity_event_repo";

function event(
  id: string,
  occurredAt: number,
  overrides: Partial<ActivityEvent> = {},
): ActivityEvent {
  return {
    id,
    type: "web.page_viewed",
    userId: "usr_actor",
    workspaceId: "ws_primary",
    source: "web",
    resourceType: null,
    resourceId: null,
    propertiesJson: '{"page":"/w/:wsId/overview"}',
    occurredAt,
    ...overrides,
  };
}

describe("D1ActivityEventRepo", () => {
  let repo: D1ActivityEventRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1ActivityEventRepo(testEnv().DB);
  });

  it("inserts a single event and lists it back newest first", async () => {
    await repo.insert(event("act_1", 1_000));
    await repo.insert(
      event("act_2", 2_000, {
        type: "browser_test.viewed",
        resourceType: "browser_test",
        resourceId: "bt_1",
        source: "app",
      }),
    );

    const rows = await repo.listRecent(10);
    expect(rows.map((row) => row.id)).toEqual(["act_2", "act_1"]);
    expect(rows[0]).toEqual(
      event("act_2", 2_000, {
        type: "browser_test.viewed",
        resourceType: "browser_test",
        resourceId: "bt_1",
        source: "app",
      }),
    );
  });

  it("inserts many events in one batch and tolerates an empty batch", async () => {
    await repo.insertMany([]);
    await repo.insertMany([event("act_a", 10), event("act_b", 20), event("act_c", 30)]);
    expect((await repo.listRecent(10)).map((row) => row.id)).toEqual([
      "act_c",
      "act_b",
      "act_a",
    ]);
  });

  it("keeps null user and workspace for system and user-level events", async () => {
    await repo.insert(
      event("act_sys", 5, {
        type: "incident.opened",
        userId: null,
        source: "server",
        resourceType: "incident",
        resourceId: "inc_1",
        propertiesJson: null,
      }),
    );
    await repo.insert(
      event("act_login", 6, { type: "user.logged_in", workspaceId: null }),
    );
    const rows = await repo.listRecent(10);
    expect(rows.find((row) => row.id === "act_sys")?.userId).toBeNull();
    expect(rows.find((row) => row.id === "act_login")?.workspaceId).toBeNull();
  });

  it("rejects sources outside the catalog", async () => {
    await expect(
      repo.insert(event("act_bad", 1, { source: "ftp" as ActivityEvent["source"] })),
    ).rejects.toThrow(/CHECK constraint/u);
  });

  it("deletes only the listed types older than the cutoff, bounded by limit", async () => {
    await repo.insertMany([
      event("act_old_visit", 100),
      event("act_old_visit_2", 110),
      event("act_old_login", 120, { type: "user.logged_in", workspaceId: null }),
      event("act_new_visit", 5_000),
    ]);

    expect(await repo.deleteOlderThan(1_000, ["web.page_viewed"], 1)).toBe(1);
    expect(await repo.deleteOlderThan(1_000, ["web.page_viewed"], 10)).toBe(1);
    expect(await repo.deleteOlderThan(1_000, ["web.page_viewed"], 10)).toBe(0);
    expect(await repo.deleteOlderThan(1_000, [], 10)).toBe(0);

    const remaining = (await repo.listRecent(10)).map((row) => row.id).sort();
    expect(remaining).toEqual(["act_new_visit", "act_old_login"]);
  });
});
```

- [ ] **Step 4: Run the itest to verify it fails**

Run: `pnpm --filter @zenguy/api test:integration -- src/infrastructure/db/activity_event_repo.itest.ts`
Expected: FAIL — cannot resolve `./activity_event_repo`.

- [ ] **Step 5: Implement the repository**

```ts
// apps/api/src/infrastructure/db/activity_event_repo.ts
import type { ActivityEventType } from "../../domain/activity/catalog";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { ActivityEvent, ActivitySource } from "../../domain/activity/types";
import { all, batch, run } from "./d1";

interface ActivityRow {
  id: string;
  type: ActivityEventType;
  user_id: string | null;
  workspace_id: string | null;
  source: ActivitySource;
  resource_type: string | null;
  resource_id: string | null;
  properties_json: string | null;
  occurred_at: number;
}

function toEvent(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    type: row.type,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    source: row.source,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    propertiesJson: row.properties_json,
    occurredAt: row.occurred_at,
  };
}

const INSERT = `INSERT INTO activity_events
  (id, type, user_id, workspace_id, source, resource_type, resource_id, properties_json, occurred_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export class D1ActivityEventRepo implements ActivityEventRepo {
  constructor(private readonly database: D1Database) {}

  private insertStatement(event: ActivityEvent): D1PreparedStatement {
    return this.database
      .prepare(INSERT)
      .bind(
        event.id,
        event.type,
        event.userId,
        event.workspaceId,
        event.source,
        event.resourceType,
        event.resourceId,
        event.propertiesJson,
        event.occurredAt,
      );
  }

  async insert(event: ActivityEvent): Promise<void> {
    await run(this.insertStatement(event));
  }

  async insertMany(events: ActivityEvent[]): Promise<void> {
    if (events.length === 0) return;
    await batch(
      this.database,
      events.map((event) => this.insertStatement(event)),
    );
  }

  async deleteOlderThan(
    before: number,
    types: ActivityEventType[],
    limit: number,
  ): Promise<number> {
    if (types.length === 0 || limit <= 0) return 0;
    const placeholders = types.map(() => "?").join(", ");
    const result = await run(
      this.database
        .prepare(
          `DELETE FROM activity_events WHERE id IN (
             SELECT id FROM activity_events
             WHERE occurred_at < ? AND type IN (${placeholders})
             ORDER BY occurred_at ASC LIMIT ?
           )`,
        )
        .bind(before, ...types, limit),
    );
    return result.meta.changes ?? 0;
  }

  async listRecent(limit: number): Promise<ActivityEvent[]> {
    return (
      await all<ActivityRow>(
        this.database
          .prepare(
            `SELECT * FROM activity_events
             ORDER BY occurred_at DESC, id DESC LIMIT ?`,
          )
          .bind(limit),
      )
    ).map(toEvent);
  }
}
```

- [ ] **Step 6: Run the itest to verify it passes**

Run: `pnpm --filter @zenguy/api test:integration -- src/infrastructure/db/activity_event_repo.itest.ts`
Expected: PASS (5 tests). Also run `pnpm --filter @zenguy/api test:integration -- src/infrastructure/db/d1.itest.ts` to confirm the migration applies cleanly with the rest.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @zenguy/api typecheck`
Expected: clean.

---

### Task 3: `TrackEvent` use case and test fakes

**Files:**
- Create: `apps/api/src/application/activity/track_event.ts`
- Create: `apps/api/src/test/fakes/activity.ts`
- Test: `apps/api/src/application/activity/track_event.test.ts`

**Interfaces:**
- Consumes: Task 1 catalog/types/repo; `sanitizeAuditMetadata`, `truncate`, `AuditMetadataValue` from `apps/api/src/shared/redact.ts`; `Clock`, `IdGenerator`, `logEvent`.
- Produces:
  - `TrackEventInput { type: ActivityEventType; userId: string | null; workspaceId?: string | null; source: ActivitySource; resourceId?: string | null; properties?: Record<string, AuditMetadataValue> }`
  - `class TrackEvent { constructor(deps: { activity: Pick<ActivityEventRepo, "insert">; clock: Clock; ids: IdGenerator }); execute(input: TrackEventInput): Promise<void> }` — never throws.
  - `buildActivityEvent(input: TrackEventInput, deps: { clock: Clock; ids: IdGenerator }): ActivityEvent | null` — pure; `null` when the input violates the catalog.
  - `ACTIVITY_PROPERTIES_MAX_CHARS = 2_000`.
  - Fakes: `class FakeActivityEventRepo implements ActivityEventRepo` (in-memory, `events: ActivityEvent[]`), `class FakeTrackEvent { calls: TrackEventInput[]; execute(input) }` usable as `Pick<TrackEvent, "execute">`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/application/activity/track_event.test.ts
import { FixedClock } from "../../shared/clock";
import { FakeActivityEventRepo } from "../../test/fakes/activity";
import { FakeIds } from "../../test/fakes/ids";
import { buildActivityEvent, TrackEvent } from "./track_event";

const NOW = 1_700_000_000_000;

function tracker(repo = new FakeActivityEventRepo()) {
  return {
    repo,
    track: new TrackEvent({ activity: repo, clock: new FixedClock(NOW), ids: new FakeIds() }),
  };
}

describe("TrackEvent", () => {
  it("stores a workspace event with the catalog resource type and sanitized properties", async () => {
    const { repo, track } = tracker();
    await track.execute({
      type: "browser_test.created",
      userId: "usr_1",
      workspaceId: "ws_1",
      source: "server",
      resourceId: "bt_1",
      properties: { name: "Checkout flow", password: "nope", count: 2 },
    });

    expect(repo.events).toHaveLength(1);
    expect(repo.events[0]).toEqual({
      id: "act_00000000000000000000000001",
      type: "browser_test.created",
      userId: "usr_1",
      workspaceId: "ws_1",
      source: "server",
      resourceType: "browser_test",
      resourceId: "bt_1",
      propertiesJson: JSON.stringify({ name: "Checkout flow", password: "***", count: 2 }),
      occurredAt: NOW,
    });
  });

  it("leaves resource columns null when no resourceId is given", async () => {
    const { repo, track } = tracker();
    await track.execute({
      type: "browser_test.run_passed",
      userId: null,
      workspaceId: "ws_1",
      source: "server",
      properties: { runId: "run_1", runSource: "VALIDATION" },
    });
    expect(repo.events[0]?.resourceType).toBeNull();
    expect(repo.events[0]?.resourceId).toBeNull();
    expect(repo.events[0]?.userId).toBeNull();
  });

  it("caps serialized properties at 2000 characters and stores null when absent", async () => {
    const { repo, track } = tracker();
    await track.execute({
      type: "user.logged_in",
      userId: "usr_1",
      source: "web",
      properties: { page: "x".repeat(5_000) },
    });
    await track.execute({ type: "user.logged_out", userId: "usr_1", source: "app" });
    expect(repo.events[0]?.propertiesJson).toHaveLength(2_000);
    expect(repo.events[1]?.propertiesJson).toBeNull();
    expect(repo.events[1]?.workspaceId).toBeNull();
  });

  it("drops events that violate the catalog scope instead of throwing", async () => {
    const { repo, track } = tracker();
    await track.execute({ type: "browser_test.viewed", userId: "usr_1", source: "web" });
    await track.execute({
      type: "user.logged_in",
      userId: "usr_1",
      workspaceId: "ws_1",
      source: "web",
    });
    await track.execute({
      type: "not.a_type" as never,
      userId: "usr_1",
      source: "web",
    });
    expect(repo.events).toHaveLength(0);
  });

  it("never throws when the repository fails", async () => {
    const failing = new FakeActivityEventRepo();
    failing.failNextInsert = true;
    const { track } = tracker(failing);
    await expect(
      track.execute({ type: "user.logged_in", userId: "usr_1", source: "web" }),
    ).resolves.toBeUndefined();
  });
});

describe("buildActivityEvent", () => {
  const deps = { clock: new FixedClock(NOW), ids: new FakeIds() };

  it("returns null for a workspace-scoped type without workspace", () => {
    expect(
      buildActivityEvent({ type: "run.viewed", userId: "u", source: "web", resourceId: "run_1" }, deps),
    ).toBeNull();
  });

  it("accepts any-scoped types with or without workspace", () => {
    expect(
      buildActivityEvent({ type: "web.page_viewed", userId: "u", source: "web" }, deps)?.workspaceId,
    ).toBeNull();
    expect(
      buildActivityEvent(
        { type: "web.page_viewed", userId: "u", workspaceId: "ws_1", source: "web" },
        deps,
      )?.workspaceId,
    ).toBe("ws_1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zenguy/api test -- src/application/activity/track_event.test.ts`
Expected: FAIL — cannot resolve `./track_event` / `../../test/fakes/activity`.

- [ ] **Step 3: Implement the fakes and the use case**

```ts
// apps/api/src/test/fakes/activity.ts
import type { ActivityEventType } from "../../domain/activity/catalog";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { ActivityEvent } from "../../domain/activity/types";
import type { TrackEventInput } from "../../application/activity/track_event";

export class FakeActivityEventRepo implements ActivityEventRepo {
  readonly events: ActivityEvent[] = [];
  failNextInsert = false;

  async insert(event: ActivityEvent): Promise<void> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("D1 unavailable");
    }
    this.events.push(event);
  }

  async insertMany(events: ActivityEvent[]): Promise<void> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("D1 unavailable");
    }
    this.events.push(...events);
  }

  async deleteOlderThan(
    before: number,
    types: ActivityEventType[],
    limit: number,
  ): Promise<number> {
    const doomed = this.events
      .filter((event) => event.occurredAt < before && types.includes(event.type))
      .sort((left, right) => left.occurredAt - right.occurredAt)
      .slice(0, limit);
    for (const event of doomed) {
      this.events.splice(this.events.indexOf(event), 1);
    }
    return doomed.length;
  }

  async listRecent(limit: number): Promise<ActivityEvent[]> {
    return [...this.events]
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, limit);
  }
}

/** Records every call; drop-in for `Pick<TrackEvent, "execute">`. */
export class FakeTrackEvent {
  readonly calls: TrackEventInput[] = [];

  async execute(input: TrackEventInput): Promise<void> {
    this.calls.push(input);
  }

  ofType(type: ActivityEventType): TrackEventInput[] {
    return this.calls.filter((call) => call.type === type);
  }
}
```

```ts
// apps/api/src/application/activity/track_event.ts
import {
  ACTIVITY_EVENT_SPECS,
  isActivityEventType,
  type ActivityEventType,
} from "../../domain/activity/catalog";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { ActivityEvent, ActivitySource } from "../../domain/activity/types";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import {
  sanitizeAuditMetadata,
  truncate,
  type AuditMetadataValue,
} from "../../shared/redact";

export const ACTIVITY_PROPERTIES_MAX_CHARS = 2_000;

export interface TrackEventInput {
  type: ActivityEventType;
  userId: string | null;
  workspaceId?: string | null;
  source: ActivitySource;
  resourceId?: string | null;
  properties?: Record<string, AuditMetadataValue>;
}

export interface TrackEventDependencies {
  activity: Pick<ActivityEventRepo, "insert">;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * Pure builder shared by `TrackEvent` and the client ingestion use case.
 * Returns null when the input does not respect the catalog (unknown type,
 * workspace-scoped type without a workspace, user-scoped type with one).
 */
export function buildActivityEvent(
  input: TrackEventInput,
  dependencies: Pick<TrackEventDependencies, "clock" | "ids">,
): ActivityEvent | null {
  if (!isActivityEventType(input.type)) return null;
  const spec = ACTIVITY_EVENT_SPECS[input.type];
  const workspaceId = input.workspaceId ?? null;
  if (spec.scope === "workspace" && workspaceId === null) return null;
  if (spec.scope === "user" && workspaceId !== null) return null;
  const resourceId = input.resourceId ?? null;
  const propertiesJson =
    input.properties === undefined
      ? null
      : truncate(
          JSON.stringify(sanitizeAuditMetadata(input.properties)),
          ACTIVITY_PROPERTIES_MAX_CHARS,
        );
  return {
    id: dependencies.ids.newId("act"),
    type: input.type,
    userId: input.userId,
    workspaceId,
    source: input.source,
    resourceType: resourceId === null ? null : spec.resourceType,
    resourceId,
    propertiesJson,
    occurredAt: dependencies.clock.now(),
  };
}

/** Records one activity event. Never throws: analytics must not break use cases. */
export class TrackEvent {
  constructor(private readonly dependencies: TrackEventDependencies) {}

  async execute(input: TrackEventInput): Promise<void> {
    try {
      const event = buildActivityEvent(input, this.dependencies);
      if (event === null) {
        logEvent("activity_event_rejected", { type: String(input.type) });
        return;
      }
      await this.dependencies.activity.insert(event);
    } catch {
      logEvent("activity_write_failed", { type: String(input.type) });
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zenguy/api test -- src/application/activity/track_event.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @zenguy/api typecheck`
Expected: clean.

---

### Task 4: `IngestClientEvents` use case

**Files:**
- Create: `apps/api/src/application/activity/ingest_client_events.ts`
- Test: `apps/api/src/application/activity/ingest_client_events.test.ts`

**Interfaces:**
- Consumes: `buildActivityEvent` (Task 3), `ACTIVITY_EVENT_SPECS`, `isActivityEventType` (Task 1), `ActivityEventRepo.insertMany`, `MemberRepo.find(workspaceId, userId)` from `apps/api/src/domain/workspaces/repo.ts`, `FakeMemberRepo` from `apps/api/src/test/fakes/repos.ts`, `FakeActivityEventRepo` (Task 3).
- Produces:
  - `ClientEventInput { type: string; workspaceId?: string; resourceId?: string; properties?: Record<string, string | number | boolean> }`
  - `class IngestClientEvents { constructor(deps: { activity: Pick<ActivityEventRepo, "insertMany">; members: Pick<MemberRepo, "find">; clock: Clock; ids: IdGenerator }); execute(input: { userId: string; source: "web" | "app"; events: ClientEventInput[] }): Promise<{ accepted: number; dropped: number }> }`
  - `MAX_CLIENT_EVENTS_PER_BATCH = 25`.

- [ ] **Step 1: Write the failing tests**

Look at how `FakeMemberRepo` is seeded in `apps/api/src/test/fakes/repos.ts` (it has an `insert`/`members` map — read the class before writing the test) and adapt the `seedMember` helper below to its actual API.

```ts
// apps/api/src/application/activity/ingest_client_events.test.ts
import { FixedClock } from "../../shared/clock";
import { FakeActivityEventRepo } from "../../test/fakes/activity";
import { FakeIds } from "../../test/fakes/ids";
import { FakeMemberRepo } from "../../test/fakes/repos";
import { IngestClientEvents } from "./ingest_client_events";

const NOW = 1_700_000_000_000;

async function seedMember(members: FakeMemberRepo, workspaceId: string, userId: string) {
  await members.insert({
    id: `mem_${workspaceId}_${userId}`,
    workspaceId,
    userId,
    role: "MEMBER",
    createdAt: NOW,
  });
}

function ingestor() {
  const activity = new FakeActivityEventRepo();
  const members = new FakeMemberRepo();
  const ingest = new IngestClientEvents({
    activity,
    members,
    clock: new FixedClock(NOW),
    ids: new FakeIds(),
  });
  return { activity, members, ingest };
}

describe("IngestClientEvents", () => {
  it("stores visits for workspaces the user belongs to, in one batch", async () => {
    const { activity, members, ingest } = ingestor();
    await seedMember(members, "ws_1", "usr_1");

    const result = await ingest.execute({
      userId: "usr_1",
      source: "web",
      events: [
        { type: "web.page_viewed", workspaceId: "ws_1", properties: { page: "/w/:wsId/overview" } },
        { type: "browser_test.viewed", workspaceId: "ws_1", resourceId: "bt_1", properties: { page: "/w/:wsId/tests/:testId" } },
        { type: "app.opened" },
      ],
    });

    expect(result).toEqual({ accepted: 3, dropped: 0 });
    expect(activity.events.map((event) => [event.type, event.workspaceId, event.resourceType, event.resourceId, event.source, event.userId, event.occurredAt])).toEqual([
      ["web.page_viewed", "ws_1", null, null, "web", "usr_1", NOW],
      ["browser_test.viewed", "ws_1", "browser_test", "bt_1", "web", "usr_1", NOW],
      ["app.opened", null, null, null, "web", "usr_1", NOW],
    ]);
  });

  it("drops events for workspaces the user is not a member of, silently", async () => {
    const { activity, members, ingest } = ingestor();
    await seedMember(members, "ws_mine", "usr_1");
    const result = await ingest.execute({
      userId: "usr_1",
      source: "app",
      events: [
        { type: "web.page_viewed", workspaceId: "ws_other" },
        { type: "run.viewed", workspaceId: "ws_other", resourceId: "run_1" },
        { type: "web.page_viewed", workspaceId: "ws_mine" },
      ],
    });
    expect(result).toEqual({ accepted: 1, dropped: 2 });
    expect(activity.events.map((event) => event.workspaceId)).toEqual(["ws_mine"]);
  });

  it("drops unknown types, server-only types and scope violations", async () => {
    const { activity, members, ingest } = ingestor();
    await seedMember(members, "ws_1", "usr_1");
    const result = await ingest.execute({
      userId: "usr_1",
      source: "web",
      events: [
        { type: "browser_test.created", workspaceId: "ws_1", resourceId: "bt_1" },
        { type: "user.logged_in" },
        { type: "made.up", workspaceId: "ws_1" },
        { type: "browser_test.viewed" },
        { type: "incident.viewed", workspaceId: "ws_1", resourceId: "inc_1" },
      ],
    });
    expect(result).toEqual({ accepted: 1, dropped: 4 });
    expect(activity.events.map((event) => event.type)).toEqual(["incident.viewed"]);
  });

  it("looks up membership once per workspace", async () => {
    const { members, ingest } = ingestor();
    await seedMember(members, "ws_1", "usr_1");
    const spy = vi.spyOn(members, "find");
    await ingest.execute({
      userId: "usr_1",
      source: "web",
      events: [
        { type: "web.page_viewed", workspaceId: "ws_1" },
        { type: "web.page_viewed", workspaceId: "ws_1" },
        { type: "web.page_viewed", workspaceId: "ws_2" },
        { type: "web.page_viewed", workspaceId: "ws_2" },
      ],
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("writes nothing when every event is dropped", async () => {
    const { activity, ingest } = ingestor();
    const spy = vi.spyOn(activity, "insertMany");
    const result = await ingest.execute({
      userId: "usr_1",
      source: "web",
      events: [{ type: "nope" }],
    });
    expect(result).toEqual({ accepted: 0, dropped: 1 });
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zenguy/api test -- src/application/activity/ingest_client_events.test.ts`
Expected: FAIL — cannot resolve `./ingest_client_events`.

- [ ] **Step 3: Implement the use case**

```ts
// apps/api/src/application/activity/ingest_client_events.ts
import {
  ACTIVITY_EVENT_SPECS,
  isActivityEventType,
} from "../../domain/activity/catalog";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { ActivityEvent } from "../../domain/activity/types";
import type { MemberRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { buildActivityEvent } from "./track_event";

export const MAX_CLIENT_EVENTS_PER_BATCH = 25;

export interface ClientEventInput {
  type: string;
  workspaceId?: string;
  resourceId?: string;
  properties?: Record<string, string | number | boolean>;
}

export interface IngestClientEventsInput {
  userId: string;
  source: "web" | "app";
  events: ClientEventInput[];
}

export interface IngestClientEventsResult {
  accepted: number;
  dropped: number;
}

export interface IngestClientEventsDependencies {
  activity: Pick<ActivityEventRepo, "insertMany">;
  members: Pick<MemberRepo, "find">;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * Accepts a batch of client-reported events (visits). Anything a client may
 * not report — unknown types, server-only types, scope violations, foreign
 * workspaces — is dropped without an error so the response never reveals
 * whether a workspace exists.
 */
export class IngestClientEvents {
  constructor(private readonly dependencies: IngestClientEventsDependencies) {}

  async execute(input: IngestClientEventsInput): Promise<IngestClientEventsResult> {
    const memberships = new Map<string, Promise<boolean>>();
    const isMember = (workspaceId: string): Promise<boolean> => {
      let pending = memberships.get(workspaceId);
      if (pending === undefined) {
        pending = this.dependencies.members
          .find(workspaceId, input.userId)
          .then((member) => member !== null);
        memberships.set(workspaceId, pending);
      }
      return pending;
    };

    const accepted: ActivityEvent[] = [];
    for (const candidate of input.events) {
      if (!isActivityEventType(candidate.type)) continue;
      if (!ACTIVITY_EVENT_SPECS[candidate.type].client) continue;
      if (candidate.workspaceId !== undefined && !(await isMember(candidate.workspaceId))) {
        continue;
      }
      const event = buildActivityEvent(
        {
          type: candidate.type,
          userId: input.userId,
          workspaceId: candidate.workspaceId ?? null,
          source: input.source,
          resourceId: candidate.resourceId ?? null,
          ...(candidate.properties === undefined ? {} : { properties: candidate.properties }),
        },
        this.dependencies,
      );
      if (event === null) continue;
      accepted.push(event);
    }

    if (accepted.length > 0) {
      await this.dependencies.activity.insertMany(accepted);
    }
    return { accepted: accepted.length, dropped: input.events.length - accepted.length };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zenguy/api test -- src/application/activity/ingest_client_events.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @zenguy/api typecheck`
Expected: clean.

---

### Task 5: Bridge audited mutations into activity (`WriteAudit`)

**Files:**
- Modify: `apps/api/src/application/audit/write_audit.ts`
- Test: `apps/api/src/application/audit/write_audit.test.ts` (append tests; do not change existing ones)

**Interfaces:**
- Consumes: `AUDIT_TO_ACTIVITY` (Task 1), `TrackEvent` (Task 3), `FakeTrackEvent` (Task 3).
- Produces: `WriteAuditDependencies.activity?: Pick<TrackEvent, "execute">`. After a successful audit insert, `WriteAudit` calls `activity.execute({ type: AUDIT_TO_ACTIVITY[action], userId: actorUserId, workspaceId, source: "server", resourceId, properties: metadata })`.

- [ ] **Step 1: Append the failing tests**

Add to the existing `describe("WriteAudit", ...)` in `write_audit.test.ts` (keep the existing imports; add `import { FakeTrackEvent } from "../../test/fakes/activity";`):

```ts
  it("bridges every audited action into an activity event", async () => {
    const audits = new FakeAuditRepo();
    const activity = new FakeTrackEvent();
    const writer = new WriteAudit({
      audits,
      activity,
      clock: new FixedClock(1_700_000_000_000),
      ids: new FakeIds(),
    });

    await writer.execute({
      workspaceId: "ws_primary",
      actorUserId: "usr_actor",
      action: AUDIT_ACTIONS.testCreated,
      resourceType: "browser_test",
      resourceId: "bt_1",
      metadata: { name: "Checkout", password: "hidden" },
      ip: "203.0.113.5",
    });

    expect(activity.calls).toEqual([
      {
        type: "browser_test.created",
        userId: "usr_actor",
        workspaceId: "ws_primary",
        source: "server",
        resourceId: "bt_1",
        properties: { name: "Checkout", password: "hidden" },
      },
    ]);
    expect(audits.entries.size).toBe(1);
  });

  it("bridges system actions with a null actor and without metadata", async () => {
    const activity = new FakeTrackEvent();
    const writer = new WriteAudit({
      audits: new FakeAuditRepo(),
      activity,
      clock: new FixedClock(1),
      ids: new FakeIds(),
    });
    await writer.execute({
      workspaceId: "ws_primary",
      actorUserId: null,
      action: AUDIT_ACTIONS.billingSubscriptionUpdated,
    });
    expect(activity.calls).toEqual([
      {
        type: "billing.subscription_updated",
        userId: null,
        workspaceId: "ws_primary",
        source: "server",
        resourceId: null,
      },
    ]);
  });

  it("still writes the audit entry when no activity tracker is configured", async () => {
    const audits = new FakeAuditRepo();
    const writer = new WriteAudit({ audits, clock: new FixedClock(1), ids: new FakeIds() });
    await writer.execute({
      workspaceId: "ws_primary",
      actorUserId: "usr_actor",
      action: AUDIT_ACTIONS.workspaceUpdated,
    });
    expect(audits.entries.size).toBe(1);
  });

  it("does not bridge when the audit insert failed", async () => {
    const audits = new FakeAuditRepo();
    audits.insert = async () => {
      throw new Error("D1 down");
    };
    const activity = new FakeTrackEvent();
    const writer = new WriteAudit({ audits, activity, clock: new FixedClock(1), ids: new FakeIds() });
    await writer.execute({
      workspaceId: "ws_primary",
      actorUserId: "usr_actor",
      action: AUDIT_ACTIONS.workspaceUpdated,
    });
    expect(activity.calls).toEqual([]);
  });
```

Note: `WriteAudit.execute` today passes metadata through `sanitizeAuditMetadata` before JSON-serializing it; the bridge passes the **raw** `input.metadata` to `TrackEvent`, which sanitizes again. The first test therefore expects `password: "hidden"` in the call (sanitization happens inside `TrackEvent`, already covered by Task 3).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zenguy/api test -- src/application/audit/write_audit.test.ts`
Expected: FAIL — `activity` is not a known dependency / `calls` is empty.

- [ ] **Step 3: Implement the bridge**

Edit `apps/api/src/application/audit/write_audit.ts`:

1. Add imports: `import { AUDIT_TO_ACTIVITY } from "../../domain/activity/catalog";` and `import type { TrackEvent } from "../activity/track_event";`.
2. Extend the dependencies interface:

```ts
export interface WriteAuditDependencies {
  audits: AuditRepo;
  /** Optional bridge: every audited mutation also becomes an activity event. */
  activity?: Pick<TrackEvent, "execute">;
  clock: Clock;
  ids: IdGenerator;
}
```

3. Inside `execute`, immediately after the `await this.dependencies.audits.insert({...})` call and still inside the `try`, add:

```ts
      await this.dependencies.activity?.execute({
        type: AUDIT_TO_ACTIVITY[input.action],
        userId: input.actorUserId,
        workspaceId: input.workspaceId,
        source: "server",
        resourceId: input.resourceId ?? null,
        ...(input.metadata === undefined ? {} : { properties: input.metadata }),
      });
```

Keep the existing `catch { logEvent("audit_write_failed"); }` — `TrackEvent` never throws, so the bridge cannot trigger it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zenguy/api test -- src/application/audit/write_audit.test.ts`
Expected: PASS (all existing tests + 4 new).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @zenguy/api typecheck`
Expected: clean.

---

### Task 6: Auth events (register, verify, login, logout)

**Files:**
- Modify: `apps/api/src/application/auth/register.ts`, `verify_email.ts`, `login.ts`, `logout.ts`
- Modify: `apps/api/src/http/routes/auth.ts` (pass `client` and `track`)
- Test: `apps/api/src/application/auth/register.test.ts`, `verify_email.test.ts`, `login.test.ts`, `logout.test.ts` (append tests)

**Interfaces:**
- Consumes: `ACTIVITY_EVENTS` (Task 1), `TrackEvent`, `FakeTrackEvent` (Task 3), `authTestDependencies()` from `apps/api/src/test/fakes/auth.ts` (read it: it returns the shared dependency object used by these tests; add `track: new FakeTrackEvent()` **inside each new test** by spreading: `{ ...authTestDependencies(), track }` — do not modify `fakes/auth.ts`).
- Produces:
  - `export type AuthClient = "web" | "app";` exported from `apps/api/src/application/auth/session.ts`.
  - `Register.execute(input: RegisterInput & { client: AuthClient })`, `VerifyEmail.execute({ token, client })`, `Login.execute({ email, password, client })`, `Logout.execute({ refreshTokenPlain, client })`.
  - Each `*Dependencies` interface gains `track?: Pick<TrackEvent, "execute">`.
  - `AuthRoutesDependencies.track?: Pick<TrackEvent, "execute">`; the route derives `client` with the existing `isNativeClient(context) ? "app" : "web"`.

- [ ] **Step 1: Append failing tests**

Add one test per use case. Read each existing test file first to reuse its helpers (`authTestDependencies`, `testUser`, token seeding). Template for `login.test.ts`:

```ts
import { FakeTrackEvent } from "../../test/fakes/activity";

  it("records user.logged_in with the client as source", async () => {
    const track = new FakeTrackEvent();
    const dependencies = { ...authTestDependencies(), track };
    const user = testUser({ passwordHash: await hashPassword("correct horse battery") });
    await dependencies.users.insertIfAbsent(user);
    const login = new Login(dependencies);

    await login.execute({ email: user.email, password: "correct horse battery", client: "app" });

    expect(track.calls).toEqual([
      { type: "user.logged_in", userId: user.id, source: "app" },
    ]);
  });

  it("records nothing when credentials are wrong", async () => {
    const track = new FakeTrackEvent();
    const login = new Login({ ...authTestDependencies(), track });
    await expect(
      login.execute({ email: "ghost@example.com", password: "wrong", client: "web" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(track.calls).toEqual([]);
  });
```

Equivalent tests:
- `register.test.ts`: a brand-new email records `{ type: "user.registered", userId: <new user id>, source: "web" }`; registering an existing email records nothing.
- `verify_email.test.ts`: consuming a valid token records `{ type: "user.email_verified", userId, source: "web" }`.
- `logout.test.ts`: a known refresh token records `{ type: "user.logged_out", userId: token.userId, source: "web" }`; `refreshTokenPlain: null` records nothing.

Also update every existing `execute({...})` call in these four test files to include `client: "web"` (TypeScript will point at each one).

- [ ] **Step 2: Run the auth tests to verify they fail**

Run: `pnpm --filter @zenguy/api test -- src/application/auth`
Expected: FAIL on the new tests (and type errors on `client`).

- [ ] **Step 3: Implement**

In `session.ts` add `export type AuthClient = "web" | "app";`.

`login.ts`:

```ts
import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type { TrackEvent } from "../activity/track_event";
import type { AuthClient } from "./session";

export interface LoginDependencies extends SessionDependencies {
  users: UserRepo;
  track?: Pick<TrackEvent, "execute">;
}
// execute(input: { email: string; password: string; client: AuthClient })
// ... after the rehash block, before `return createSession(...)`:
    await this.dependencies.track?.execute({
      type: ACTIVITY_EVENTS.userLoggedIn,
      userId: user.id,
      source: input.client,
    });
```

`logout.ts`: add `track?` to `LogoutDependencies`, `client: AuthClient` to the input, and inside `if (token !== null) { ... }` after `revokeAllForUser`:

```ts
      await this.dependencies.track?.execute({
        type: ACTIVITY_EVENTS.userLoggedOut,
        userId: token.userId,
        source: input.client,
      });
```

`register.ts`: add `track?` to its dependencies interface and `client: AuthClient` to `RegisterInput` (or to the `execute` parameter type — follow how `RegisterInput` is declared/parsed in the file; if the input is parsed through a schema/normalizer, add `client` outside that normalization). Emit only on the successful-creation path, right after `insertIfAbsent` returned true and before the email token insert:

```ts
    await this.dependencies.track?.execute({
      type: ACTIVITY_EVENTS.userRegistered,
      userId: user.id,
      source: input.client,
    });
```

`verify_email.ts`: add `track?` and `client`, emit after `setEmailVerified`:

```ts
    await this.dependencies.track?.execute({
      type: ACTIVITY_EVENTS.userEmailVerified,
      userId: user.id,
      source: input.client,
    });
```

`http/routes/auth.ts`:
1. `AuthRoutesDependencies` gains `track?: Pick<TrackEvent, "execute">;` (import type `TrackEvent` from `../../application/activity/track_event`). The use cases are built with `new Login(dependencies)` etc., so they receive `track` automatically.
2. Add a helper next to `isNativeClient`: `function clientKind(context: Context<AppEnv>): "web" | "app" { return isNativeClient(context) ? "app" : "web"; }`.
3. Pass `client: clientKind(context)` in the four `execute` calls: `/register` → `register.execute({ ...context.req.valid("json"), client: clientKind(context) })`; `/verify-email` → `verifyEmail.execute({ ...context.req.valid("json"), client: clientKind(context) })`; `/login` → `login.execute({ ...input, client: clientKind(context) })`; both `/logout` branches → `logout.execute({ refreshTokenPlain: ..., client: clientKind(context) })`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @zenguy/api test -- src/application/auth && pnpm --filter @zenguy/api typecheck`
Expected: PASS; typecheck clean (route itests exercising these paths keep passing because `client` is derived in the route).

Run: `pnpm --filter @zenguy/api test:integration -- src/http/routes/auth_routes.itest.ts`
Expected: PASS (no behavior change for existing assertions).

---

### Task 7: Execution, incident and alert events

**Files:**
- Modify: `apps/api/src/application/execution/attempt_lifecycle.ts` (+ `attempt_lifecycle.test.ts`)
- Modify: `apps/api/src/application/incidents/handle_run_finalized.ts` (+ `handle_run_finalized.test.ts`)
- Modify: `apps/api/src/application/uptime/handle_check_message.ts` (+ `handle_check_message.test.ts`)
- Modify: `apps/api/src/application/channels/send_queued_notification.ts` (+ `send_queued_notification.test.ts`)

**Interfaces:**
- Consumes: `ACTIVITY_EVENTS`, `TrackEvent`, `FakeTrackEvent`.
- Produces: `AttemptLifecycleDependencies.track?`, `HandleRunFinalizedDependencies.track?`, `HandleCheckMessageDependencies.track?`, and a new optional trailing constructor parameter on `SendQueuedNotification` (`track?: Pick<TrackEvent, "execute">`, after `workspaceOperational?`).

- [ ] **Step 1: Append failing tests**

Read each test file to find the existing fixture builders (they construct the dependency objects; add `track` there via a `FakeTrackEvent` instance exposed to assertions).

`attempt_lifecycle.test.ts` — find the existing test that drives a run to a terminal status through `onAttemptFinished` (a PASSED outcome and a FAILED-after-retries outcome) and add assertions:

```ts
    expect(track.ofType("browser_test.run_passed")).toEqual([
      expect.objectContaining({
        userId: run.triggeredByUserId,          // null for SCHEDULED runs
        workspaceId: run.workspaceId,
        source: "server",
        resourceId: run.browserTestId,
        properties: expect.objectContaining({
          runId: run.id,
          runSource: run.source,
          attemptCount: expect.any(Number),
          durationMs: expect.any(Number),
          passedAfterRetry: expect.any(Boolean),
        }),
      }),
    ]);
```

and for a FAILED run `track.ofType("browser_test.run_failed")` has length 1, TIMEOUT → `run_timed_out`, SYSTEM_ERROR → `run_errored`. Also assert that resuming the same finalization job a second time does not emit twice when the job is already `COMPLETED` (call the same entry point again; `ofType(...)` stays at length 1).

`handle_run_finalized.test.ts` — in the test that opens an incident: `expect(track.ofType("incident.opened")).toEqual([expect.objectContaining({ userId: null, workspaceId: run.workspaceId, source: "server", resourceId: <incident id>, properties: { kind: "BROWSER_TEST", browserTestId: <test id>, runId: run.id } })])`; in the recovery test: one `incident.resolved` call with the same shape.

`handle_check_message.test.ts` — DOWN transition: one `incident.opened` with `properties: { kind: "UPTIME_MONITOR", uptimeMonitorId: monitor.id, checkId: check.id }`; recovery: one `incident.resolved`.

`send_queued_notification.test.ts` — SENT path: `track.ofType("alert.sent")` equals one call `{ userId: null, workspaceId: delivery.workspaceId, source: "server", resourceId: delivery.id, properties: { channelId: channel.id, channelType: channel.type, incidentId: delivery.incidentId } }` (adapt property names to the `NotificationDelivery`/`NotificationChannel` types in `apps/api/src/domain/channels/types.ts`); terminal FAILED path: one `alert.failed`.

- [ ] **Step 2: Run the four test files to verify the new assertions fail**

Run: `pnpm --filter @zenguy/api test -- src/application/execution/attempt_lifecycle.test.ts src/application/incidents/handle_run_finalized.test.ts src/application/uptime/handle_check_message.test.ts src/application/channels/send_queued_notification.test.ts`
Expected: the new assertions FAIL; everything else passes.

- [ ] **Step 3: Implement**

`attempt_lifecycle.ts`:
- `AttemptLifecycleDependencies` gains `track?: Pick<TrackEvent, "execute">;`.
- Add a module-level map:

```ts
const RUN_ACTIVITY: Record<"PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR", ActivityEventType> = {
  PASSED: ACTIVITY_EVENTS.browserTestRunPassed,
  FAILED: ACTIVITY_EVENTS.browserTestRunFailed,
  TIMEOUT: ACTIVITY_EVENTS.browserTestRunTimedOut,
  SYSTEM_ERROR: ACTIVITY_EVENTS.browserTestRunErrored,
};
```

- In `resumeRunFinalization`, after the `runFinalizedHandler.handle(...)` block and **before** `durable.completeJob(...)`:

```ts
    await this.dependencies.track?.execute({
      type: RUN_ACTIVITY[run.status as keyof typeof RUN_ACTIVITY],
      userId: run.triggeredByUserId,
      workspaceId: run.workspaceId,
      source: "server",
      resourceId: run.browserTestId,
      properties: {
        runId: run.id,
        runSource: run.source,
        attemptCount: run.attemptCount,
        durationMs: run.durationMs ?? 0,
        passedAfterRetry: run.passedAfterRetry,
      },
    });
```

`isRunTerminal(run)` has already been checked above, so the cast is safe. The early `return` when the job is not `PENDING` guarantees no duplicate on a completed job.

`handle_run_finalized.ts`: `HandleRunFinalizedDependencies.track?`; after `const opened = await this.dependencies.incidents.insertOpen(candidate)` (use the returned incident if `insertOpen` returns it; otherwise `candidate`), emit `incident.opened` with `resourceId: <incident id>`, `properties: { kind: "BROWSER_TEST", browserTestId: testId, runId: run.id }`; in `recordRecovery` right after `incidents.resolve(...)`, emit `incident.resolved` with `properties: { kind: "BROWSER_TEST", browserTestId: incident.browserTestId, runId: run.id }`. Both with `userId: null`, `workspaceId: run.workspaceId`, `source: "server"`.

`handle_check_message.ts`: same two points around `insertOpen` (properties `{ kind: "UPTIME_MONITOR", uptimeMonitorId: monitor.id, checkId: check.id }`) and `incidents.resolve` (same properties), `workspaceId: monitor.workspaceId`.

`send_queued_notification.ts`: add the trailing constructor parameter `private readonly track?: Pick<TrackEvent, "execute">` after `workspaceOperational?`; after the SENT `finishDispatch`/`recordProviderAcceptance` section (before `reconcileTerminal`), emit `alert.sent`; in the terminal FAILED branch(es) that call `reconcileTerminal` with `status: "FAILED"` (the ones that do **not** requeue/retry), emit `alert.failed`. Use `resourceId: delivery.id`, `workspaceId: delivery.workspaceId`, `userId: null`, `source: "server"`, `properties: { channelId: channel.id, channelType: channel.type, incidentId: delivery.incidentId }` (adjust to actual field names).

- [ ] **Step 4: Run tests and typecheck**

Run: the same four test files, then `pnpm --filter @zenguy/api typecheck`.
Expected: PASS; clean.

---

### Task 8: Remaining explicit emission points

**Files:**
- Modify: `apps/api/src/application/browser_tests/validate_draft.ts`, `import_tests.ts`, `download_report.ts` (+ `download_report.test.ts`)
- Modify: `apps/api/src/application/uptime/test_request.ts`
- Modify: `apps/api/src/application/alerts/start_credit_topup.ts` (+ `start_credit_topup.test.ts`)
- Modify: `apps/api/src/application/billing/paddle_checkout_intent.ts`
- Modify: `apps/api/src/application/push/register_push_device.ts` (+ `register_push_device.test.ts`)
- Modify: `apps/api/src/http/routes/browser_tests.ts`, `uptime.ts`, `alerts.ts`, `billing.ts`, `push_devices.ts`, `public_api.ts`
- Create: `apps/api/src/application/activity/explicit_points.test.ts` (unit tests for use cases that have no test file yet: `ValidateDraft`, `ImportTests`, `TestRequest`, `IssuePaddleCheckoutIntent`)

**Interfaces:**
- Consumes: `ACTIVITY_EVENTS`, `TrackEvent`, `FakeTrackEvent`; each route's `*RoutesDependencies` interface.
- Produces: every listed use case gets an optional trailing constructor parameter `track?: Pick<TrackEvent, "execute">`; every listed route dependencies interface gets `track?: Pick<TrackEvent, "execute">` and passes it when constructing the use case. The route files are the **only** place these use cases are constructed outside tests (verify with `grep -rn "new ValidateDraft\|new ImportTests\|new DownloadReport\|new TestRequest\|new StartCreditTopUp\|new IssuePaddleCheckoutIntent\|new RegisterPushDevice" apps/api/src --include='*.ts' | grep -v test`); if `app.ts` constructs any of them, leave `app.ts` alone — Task 10 wires it there.

Emission table (actor = `input.actor.id` / `input.userId` as each use case names it; `source: "server"`):

| Use case | Type | workspaceId | resourceId | properties |
| --- | --- | --- | --- | --- |
| `ValidateDraft.execute` (after `createRun`) | `browser_test.validated` | input.workspaceId | — | `{ runId }` |
| `ImportTests.execute` (end, success) | `browser_test.imported` | input.workspaceId | — | `{ created, updated }` (counts it already computes) |
| `DownloadReport.execute` (after authorizing the run) | `report.downloaded` | run.workspaceId | run.id | `{ browserTestId }` (nullable ok) |
| `TestRequest.execute` (after the check executes) | `uptime_monitor.tested` | input.workspaceId | — | `{ status }` of the outcome |
| `StartCreditTopUp.execute` | `alerts.topup_started` | input.workspaceId | — | `{ amountCents }` (whatever the input names it) |
| `IssuePaddleCheckoutIntent.execute` | `billing.checkout_started` | input.workspaceId | — | `{ kind }` (subscription vs top-up if the input distinguishes; else omit) |
| `RegisterPushDevice.execute` | `push_device.registered` | — (user scope) | device.id | `{ platform }` |
| `browser_tests.ts` export handler (after `listBrowserTests`) | `browser_test.exported` | workspaceEntity.id | — | `{ count, format }` |
| `public_api.ts` `recordUse` middleware | `api_key.used` | apiKey.workspaceId | apiKey.id | — ; `userId: null`, `source: "api"`, **only if** `apiKey.lastUsedAt === null \|\| now - apiKey.lastUsedAt > 15 * 60_000` (read `lastUsedAt` from `context.get("apiKey")` **before** calling `touchLastUsed`) |

- [ ] **Step 1: Write failing tests**

`explicit_points.test.ts` — one `describe` per use case, constructing it with minimal fakes exactly as the existing tests in those folders do (look at `run_rate.ts`, `fakes/repos.ts`, `fakes/uptime_repos.ts`, `fakes/paddle_checkout_intents.ts`, `fakes/billing.ts` for ready-made fakes). Each test asserts `track.calls` equals the single expected call. Example for `ValidateDraft`:

```ts
describe("ValidateDraft activity", () => {
  it("records browser_test.validated after creating the validation run", async () => {
    const track = new FakeTrackEvent();
    const createRun = { execute: vi.fn(async () => ({ id: "run_1" }) as never) };
    const validate = new ValidateDraft(createRun, subscriptions, rateLimiter, track);
    await validate.execute({ workspaceId: "ws_1", actor: owner, actorRole: "OWNER", draft });
    expect(track.calls).toEqual([
      { type: "browser_test.validated", userId: owner.id, workspaceId: "ws_1", source: "server", properties: { runId: "run_1" } },
    ]);
  });
});
```

Append analogous tests to `download_report.test.ts`, `start_credit_topup.test.ts`, `register_push_device.test.ts`. For `api_key.used`, add two cases to `apps/api/src/http/routes/api_key_routes.itest.ts`? No — that file is shared; instead cover the throttle in Task 10's end-to-end itest. Here, keep the middleware logic in a small exported pure helper in `public_api.ts`: `export function shouldRecordApiKeyUse(lastUsedAt: number | null, now: number): boolean` and test it in `explicit_points.test.ts` (`null → true`, `now - 14min → false`, `now - 16min → true`).

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm --filter @zenguy/api test -- src/application/activity/explicit_points.test.ts src/application/browser_tests/download_report.test.ts src/application/alerts/start_credit_topup.test.ts src/application/push/register_push_device.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement per the table**

Pattern for a positional constructor (e.g. `ValidateDraft`):

```ts
import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type { TrackEvent } from "../activity/track_event";

  constructor(
    private readonly createRun: Pick<CreateRun, "execute">,
    private readonly subscriptions: SubscriptionRepo,
    private readonly rateLimiter: RateLimiter,
    private readonly track?: Pick<TrackEvent, "execute">,
  ) {}

  // after the run is created:
    await this.track?.execute({
      type: ACTIVITY_EVENTS.browserTestValidated,
      userId: input.actor.id,
      workspaceId: input.workspaceId,
      source: "server",
      properties: { runId: run.id },
    });
```

Route wiring pattern (e.g. in `uptime.ts`): add `track?: Pick<TrackEvent, "execute">;` to `UptimeRoutesDependencies` and pass `dependencies.track` as the new trailing argument of `new TestRequest(...)`. Same for `browser_tests.ts` (`ValidateDraft`, `ImportTests`, `DownloadReport`, plus the export handler uses `dependencies.track?.execute(...)` directly with `userId: context.get("user").id`), `alerts.ts` (`StartCreditTopUp` — note it wraps `IssuePaddleCheckoutIntent`; pass `track` to **both** only if both are constructed here; `StartCreditTopUp` emits `alerts.topup_started`, `IssuePaddleCheckoutIntent` emits `billing.checkout_started`), `billing.ts` (`IssuePaddleCheckoutIntent`), `push_devices.ts` (`RegisterPushDevice`), `public_api.ts` (`track?` in deps; `recordUse` emits).

- [ ] **Step 4: Run tests and typecheck**

Run: the test files above, then `pnpm --filter @zenguy/api typecheck`.
Expected: PASS; clean.

---

### Task 9: `POST /api/me/events` route, rate limit, matrices, repo in `app.ts`

**Files:**
- Create: `apps/api/src/http/routes/activity.ts`
- Test: `apps/api/src/http/routes/activity_routes.itest.ts`
- Modify: `apps/api/src/shared/constants.ts` (`RATE_LIMITS.events`)
- Modify: `apps/api/src/app.ts` (**only**: `AppOverrides.activityEvents`, `const activityEvents = ...`, and the `app.route("/api/me", activityRoutes({...}))` mount right after the existing `/api/me` push-device mount)
- Modify: `apps/api/src/http/routes/rbac_matrix.itest.ts`, `apps/api/src/http/routes/cross_tenant.itest.ts`

**Interfaces:**
- Consumes: `IngestClientEvents`, `MAX_CLIENT_EVENTS_PER_BATCH` (Task 4), `D1ActivityEventRepo` (Task 2), `ActivityEventRepo`, `requireAuth`, `rateLimit`, `zjson`.
- Produces: `activityRoutes(deps: { users: UserRepo; members: Pick<MemberRepo, "find">; activityEvents: Pick<ActivityEventRepo, "insertMany">; rateLimiter: RateLimiter; clock: Clock; ids: IdGenerator; config: Pick<AppConfig, "jwtSecret"> }): Hono<AppEnv>` exposing `POST /events` (mounted under `/api/me`); `AppOverrides.activityEvents?: ActivityEventRepo`; `RATE_LIMITS.events = { limit: 60, windowSeconds: 60 }`.

- [ ] **Step 1: Write the failing itest**

Model the fixture on `audit_routes.itest.ts` (users/workspace/member seeding through the D1 repos, `issueAccessToken` for bearer tokens, `buildApp(testEnv(), { clock, ids })`).

```ts
// apps/api/src/http/routes/activity_routes.itest.ts  (fixture code elided: copy from audit_routes.itest.ts)
describe("POST /api/me/events", () => {
  it("stores web visits for the caller and reports counts", async () => {
    const response = await app.request("/api/me/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [
          { type: "web.page_viewed", workspaceId: WORKSPACE.id, properties: { page: "/w/:wsId/overview" } },
          { type: "browser_test.viewed", workspaceId: WORKSPACE.id, resourceId: "bt_1" },
        ],
      }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { accepted: 2, dropped: 0 } });
    const rows = await new D1ActivityEventRepo(testEnv().DB).listRecent(10);
    expect(rows.map((row) => [row.type, row.source, row.userId, row.workspaceId])).toEqual([
      ["browser_test.viewed", "web", USERS.member.id, WORKSPACE.id],
      ["web.page_viewed", "web", USERS.member.id, WORKSPACE.id],
    ]);
  });

  it("marks native clients as app", async () => { /* header X-Zenguy-Client: native → source "app" */ });
  it("drops events for a workspace the caller does not belong to", async () => { /* accepted 0 dropped 1, no rows, status 202 */ });
  it("drops server-only types", async () => { /* browser_test.created → dropped */ });
  it("rejects unauthenticated calls", async () => { /* 401 */ });
  it("rejects batches over 25 events or malformed properties", async () => { /* 400 VALIDATION_ERROR for 26 events; 400 for properties: { nested: {} } */ });
  it("rate limits per user", async () => { /* use overrides.rateLimiter with a fake that denies on the 2nd hit → 429 */ });
  it("does not require a verified email", async () => { /* user with emailVerifiedAt null → 202 */ });
});
```

Write the elided tests fully (each is 5–15 lines with the shared fixture).

- [ ] **Step 2: Run the itest to verify it fails**

Run: `pnpm --filter @zenguy/api test:integration -- src/http/routes/activity_routes.itest.ts`
Expected: FAIL (404 / missing module).

- [ ] **Step 3: Implement**

`constants.ts`: inside `RATE_LIMITS` add `events: { limit: 60, windowSeconds: 60 },` with the comment `/** Client activity batches (visits); one D1 write per batch. */`.

```ts
// apps/api/src/http/routes/activity.ts
import { Hono } from "hono";
import { z } from "zod";
import {
  IngestClientEvents,
  MAX_CLIENT_EVENTS_PER_BATCH,
} from "../../application/activity/ingest_client_events";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { UserRepo } from "../../domain/users/repo";
import type { MemberRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import type { IdGenerator } from "../../shared/ids";
import { rateLimit, type RateLimiter } from "../../shared/ratelimit";
import type { AppEnv } from "../env";
import { requireAuth } from "../middleware/auth";
import { zjson } from "../validate";

export interface ActivityRoutesDependencies {
  users: UserRepo;
  members: Pick<MemberRepo, "find">;
  activityEvents: Pick<ActivityEventRepo, "insertMany">;
  rateLimiter: RateLimiter;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret">;
}

const NATIVE_CLIENT_HEADER = "X-Zenguy-Client";

const propertyValue = z.union([z.string().max(200), z.number(), z.boolean()]);
const eventSchema = z.object({
  type: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64).optional(),
  resourceId: z.string().min(1).max(64).optional(),
  properties: z
    .record(z.string().max(40), propertyValue)
    .refine((value) => Object.keys(value).length <= 20, {
      message: "At most 20 properties",
    })
    .optional(),
});
const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(MAX_CLIENT_EVENTS_PER_BATCH),
});

/** Client-reported activity (page/screen visits), mounted under `/api/me`. */
export function activityRoutes(
  dependencies: ActivityRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const ingest = new IngestClientEvents({
    activity: dependencies.activityEvents,
    members: dependencies.members,
    clock: dependencies.clock,
    ids: dependencies.ids,
  });

  app.post(
    "/events",
    requireAuth(dependencies),
    rateLimit(
      dependencies.rateLimiter,
      (context) => `events:user:${context.get("user").id}`,
      RATE_LIMITS.events.limit,
      RATE_LIMITS.events.windowSeconds,
    ),
    zjson(batchSchema),
    async (context) => {
      const native =
        context.req.header(NATIVE_CLIENT_HEADER)?.trim().toLowerCase() === "native";
      const result = await ingest.execute({
        userId: context.get("user").id,
        source: native ? "app" : "web",
        events: context.req.valid("json").events,
      });
      return context.json({ data: result }, 202);
    },
  );

  return app;
}
```

`app.ts` (three minimal hunks):
1. Imports: `import type { ActivityEventRepo } from "./domain/activity/repo";`, `import { D1ActivityEventRepo } from "./infrastructure/db/activity_event_repo";`, `import { activityRoutes } from "./http/routes/activity";`.
2. `AppOverrides`: add `activityEvents?: ActivityEventRepo;`.
3. After `const audits = overrides.audits ?? new D1AuditRepo(env.DB);` add `const activityEvents = overrides.activityEvents ?? new D1ActivityEventRepo(env.DB);`. Directly after the existing `app.route("/api/me", pushDeviceRoutes({...}))` block add:

```ts
  app.route(
    "/api/me",
    activityRoutes({
      users,
      members,
      activityEvents,
      rateLimiter,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
```

`rbac_matrix.itest.ts`: next to the `/api/me/push-devices` cases add
`route("POST /api/me/events", "A", 202, "/api/me/events", json("POST", { events: [{ type: "app.opened" }] })),` (check what access class `"A"` means in that file — it is the "any authenticated user" class used by push-devices; reuse it).

`cross_tenant.itest.ts`: add a probe that posts `{ events: [{ type: "web.page_viewed", workspaceId: WORKSPACE_B.id }] }` as a user of workspace A and asserts `202` with `{ accepted: 0, dropped: 1 }` and no row for `WORKSPACE_B.id` in `activity_events` (the probe list there expects 404s; add this as a separate `it` rather than in the 404 loop).

- [ ] **Step 4: Run the itests and typecheck**

Run: `pnpm --filter @zenguy/api test:integration -- src/http/routes/activity_routes.itest.ts src/http/routes/rbac_matrix.itest.ts src/http/routes/cross_tenant.itest.ts && pnpm --filter @zenguy/api typecheck`
Expected: PASS; clean.

---

### Task 10: Wiring (`app.ts`, `index.ts`), wiring test, end-to-end itest, full API gate

**Files:**
- Modify: `apps/api/src/app.ts` (construct `TrackEvent`, pass `track` everywhere, pass `activity` to `WriteAudit`)
- Modify: `apps/api/src/index.ts` (queue consumers, retention job, scheduler lifecycle)
- Create: `apps/api/src/application/activity/activity_wiring.test.ts`
- Create: `apps/api/src/http/routes/activity_end_to_end.itest.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9 and 11.
- Produces: a single `track` instance per `buildApp`/consumer build: `const track = new TrackEvent({ activity: activityEvents, clock, ids: overrides.ids ?? realIds });`.

- [ ] **Step 1: Write the wiring test (fails until every point is wired)**

```ts
// apps/api/src/application/activity/activity_wiring.test.ts
import { readFileSync } from "node:fs";
import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";

/** Explicit emission points (audited mutations are bridged by WriteAudit). */
const EXPLICIT_POINTS = {
  userRegistered: "../auth/register.ts",
  userEmailVerified: "../auth/verify_email.ts",
  userLoggedIn: "../auth/login.ts",
  userLoggedOut: "../auth/logout.ts",
  browserTestValidated: "../browser_tests/validate_draft.ts",
  browserTestImported: "../browser_tests/import_tests.ts",
  browserTestExported: "../../http/routes/browser_tests.ts",
  browserTestRunPassed: "../execution/attempt_lifecycle.ts",
  browserTestRunFailed: "../execution/attempt_lifecycle.ts",
  browserTestRunTimedOut: "../execution/attempt_lifecycle.ts",
  browserTestRunErrored: "../execution/attempt_lifecycle.ts",
  reportDownloaded: "../browser_tests/download_report.ts",
  uptimeMonitorTested: "../uptime/test_request.ts",
  incidentOpened: "../incidents/handle_run_finalized.ts",
  incidentResolved: "../incidents/handle_run_finalized.ts",
  alertSent: "../channels/send_queued_notification.ts",
  alertFailed: "../channels/send_queued_notification.ts",
  alertsTopupStarted: "../alerts/start_credit_topup.ts",
  apiKeyUsed: "../../http/routes/public_api.ts",
  billingCheckoutStarted: "../billing/paddle_checkout_intent.ts",
  pushDeviceRegistered: "../push/register_push_device.ts",
} as const satisfies Partial<Record<keyof typeof ACTIVITY_EVENTS, string>>;

const UPTIME_INCIDENT_FILE = "../uptime/handle_check_message.ts";

describe("activity wiring", () => {
  it.each(Object.entries(EXPLICIT_POINTS))(
    "emits %s from its owning module",
    (key, relativePath) => {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      expect(source).toContain(`ACTIVITY_EVENTS.${key}`);
      expect(source).toMatch(/track\??\.execute\(/u);
    },
  );

  it("emits incident transitions from uptime checks too", () => {
    const source = readFileSync(new URL(UPTIME_INCIDENT_FILE, import.meta.url), "utf8");
    expect(source).toContain("ACTIVITY_EVENTS.incidentOpened");
    expect(source).toContain("ACTIVITY_EVENTS.incidentResolved");
  });

  it("passes the tracker to every consumer in the composition roots", () => {
    const app = readFileSync(new URL("../../app.ts", import.meta.url), "utf8");
    const index = readFileSync(new URL("../../index.ts", import.meta.url), "utf8");
    expect(app).toContain("new TrackEvent(");
    expect(app).toContain("activity: track");          // WriteAudit bridge
    expect((app.match(/\btrack,/gu) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(index).toContain("new TrackEvent(");
  });
});
```

- [ ] **Step 2: Run it to verify it fails on the composition-root assertions**

Run: `pnpm --filter @zenguy/api test -- src/application/activity/activity_wiring.test.ts`
Expected: the composition-root test FAILS; the per-module tests pass (Tasks 6–8 done).

- [ ] **Step 3: Wire `app.ts`**

1. Import `TrackEvent` from `./application/activity/track_event`.
2. After `const activityEvents = ...` (Task 9) add:

```ts
  const track = new TrackEvent({
    activity: activityEvents,
    clock,
    ids: overrides.ids ?? realIds,
  });
```

3. `const audit = new WriteAudit({ audits, activity: track, clock, ids: ... })`.
4. Pass `track,` into: `authRoutes({...})`, `browserTestRoutes({...})`, `uptimeRoutes({...})`, `alertRoutes({...})`, `billingRoutes({...})`, `pushDeviceRoutes({...})`, `publicApiRoutes({...})`, the `AttemptLifecycle({...})` dependencies object, the nested `HandleRunFinalized({...})` dependencies object. (`grep -n "track" src/app.ts` afterwards must show ≥ 8 occurrences of `track,`.)

- [ ] **Step 4: Wire `index.ts`**

Add a small helper near the other builders:

```ts
function buildTracker(env: Bindings): TrackEvent {
  return new TrackEvent({
    activity: new D1ActivityEventRepo(env.DB),
    clock: systemClock,
    ids: realIds,
  });
}
```

Then: `buildAttemptLifecycle` → `track: buildTracker(env)` in both the `AttemptLifecycle` and nested `HandleRunFinalized` dependency objects (build one tracker and reuse it); `buildCheckConsumer` → `track` in `HandleCheckMessage` deps; `notifyConsumer` → pass the tracker as the new trailing argument of `new SendQueuedNotification(...)`; `buildRetentionJob` → pass `new D1ActivityEventRepo(env.DB)` as the trailing `activity` argument of `new PurgeExpired(...)` (Task 11's signature: after the logger parameter; pass `logEvent` explicitly for the logger, importing it from `./shared/log` if not already imported).

- [ ] **Step 5: End-to-end itest through `buildApp`**

```ts
// apps/api/src/http/routes/activity_end_to_end.itest.ts  (fixture: copy from audit_routes.itest.ts)
describe("activity events end to end", () => {
  it("records user.logged_in on password login", async () => {
    // seed a user with a real hash via hashPassword, POST /api/auth/login, then:
    const rows = await new D1ActivityEventRepo(testEnv().DB).listRecent(10);
    expect(rows.map((row) => [row.type, row.source, row.userId, row.workspaceId])).toEqual([
      ["user.logged_in", "web", user.id, null],
    ]);
  });

  it("bridges browser_test.created from the audited create use case", async () => {
    // POST /api/workspaces/:id/browser-tests as owner (copy a valid body from browser_test_routes.itest.ts)
    // expect one row type "browser_test.created", userId owner, workspaceId, resourceType "browser_test", source "server"
  });

  it("records the terminal run outcome with the triggering user", async () => {
    // Reuse the runner flow from browser_test_run_routes.itest.ts or runner.test.ts to drive a
    // MANUAL run to PASSED through ExternalRunner.complete; then expect one "browser_test.run_passed"
    // row with userId = owner, resourceId = test id, properties.runSource = "MANUAL".
  });
});
```

Write the three tests in full using the existing itests as templates for request bodies and runner tokens.

- [ ] **Step 6: Full API gate**

Run: `pnpm --filter @zenguy/api typecheck && pnpm --filter @zenguy/api test && pnpm --filter @zenguy/api test:integration`
Expected: all green. If an unrelated pre-existing failure appears, check `git status`/`git diff` for that file — another session may be mid-edit; report it rather than "fixing" foreign work.

---

### Task 11: Retention purge and workspace deletion

**Files:**
- Modify: `apps/api/src/application/maintenance/purge_expired.ts` (+ `purge_expired.test.ts`)
- Modify: `apps/api/src/infrastructure/db/workspace_deletion_repo.ts` (+ `workspace_deletion_repo.itest.ts`)

**Interfaces:**
- Consumes: `ActivityEventRepo.deleteOlderThan`, `activityEventTypesByVolume` (Task 1), `FakeActivityEventRepo` (Task 3).
- Produces: `PurgeExpired` constructor gains a trailing optional parameter `activity: Pick<ActivityEventRepo, "deleteOlderThan"> | null = null` **after** `logger`; `CleanupCounts.activityEvents: number`; constants `ACTIVITY_RETENTION_DAYS = { high: 90, normal: 365 } as const` exported from `purge_expired.ts`.

- [ ] **Step 1: Append failing tests**

`purge_expired.test.ts` — add a test that seeds a `FakeActivityEventRepo` with: a `web.page_viewed` at `NOW - 91 days`, one at `NOW - 89 days`, a `user.logged_in` at `NOW - 366 days`, one at `NOW - 364 days`; constructs `PurgeExpired(cleanup, artifacts, checks, storage, new FixedClock(NOW), logger, activity)` and asserts the result has `activityEvents: 2` and the repo keeps exactly the two recent events. Also assert the existing tests still pass with the parameter omitted.

`workspace_deletion_repo.itest.ts` — in the existing purge test, insert two `activity_events` rows (one for the deleted workspace, one for another workspace) before running the deletion, and assert afterwards that only the other workspace's row remains (`SELECT workspace_id FROM activity_events`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @zenguy/api test -- src/application/maintenance/purge_expired.test.ts && pnpm --filter @zenguy/api test:integration -- src/infrastructure/db/workspace_deletion_repo.itest.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`purge_expired.ts`:

```ts
import { activityEventTypesByVolume } from "../../domain/activity/catalog";
import type { ActivityEventRepo } from "../../domain/activity/repo";

export const ACTIVITY_RETENTION_DAYS = { high: 90, normal: 365 } as const;
// CleanupCounts gains `activityEvents: number` (and emptyCounts() initialises it to 0)

  constructor(
    ...existing params...,
    private readonly logger: EventLogger = logEvent,
    private readonly activity: Pick<ActivityEventRepo, "deleteOlderThan"> | null = null,
  ) {}

  // at the end of execute(), before this.logger("cleanup", ...):
    if (this.activity !== null) {
      for (const volume of ["high", "normal"] as const) {
        const before = now - ACTIVITY_RETENTION_DAYS[volume] * DAY_MS;
        const types = activityEventTypesByVolume(volume);
        while (true) {
          const deleted = await this.activity.deleteOlderThan(before, types, BATCH_LIMIT);
          counts.activityEvents += deleted;
          if (deleted === 0) break;
        }
      }
    }
```

`workspace_deletion_repo.ts`: in the batch that deletes operational tables (the block with `DELETE FROM notification_deliveries WHERE workspace_id = ?` etc.), add next to `DELETE FROM run_artifacts`:

```ts
      this.database
        .prepare("DELETE FROM activity_events WHERE workspace_id = ?")
        .bind(workspaceId),
```

- [ ] **Step 4: Run tests and typecheck**

Run the two test commands from Step 2 plus `pnpm --filter @zenguy/api typecheck`.
Expected: PASS; clean.

---

### Task 12: Admin loaders — workspaces and activity feed

**Files:**
- Create: `apps/admin/src/server/db/activity.ts`
- Create: `apps/admin/src/server/db/workspaces.ts`
- Test: `apps/admin/src/server/db/activity.itest.ts`, `apps/admin/src/server/db/workspaces.itest.ts`

**Interfaces:**
- Consumes: `isMigrationPendingError` from `apps/admin/src/server/db/errors.ts`; the API migrations (applied automatically by `vitest.integration.config.ts`).
- Produces (types exported from these modules, **not** from `shared/types.ts`):

```ts
export type ActivitySource = "web" | "app" | "api" | "server";
export interface ActivityFeedEvent {
  id: string; type: string; occurredAt: number; source: ActivitySource;
  actor: { id: string; name: string; email: string } | null;
  workspace: { id: string; name: string } | null;
  resourceType: string | null; resourceId: string | null;
  properties: Record<string, unknown> | null;
}
export type ActivityFeedResponse = { events: ActivityFeedEvent[] } | { unavailable: "MIGRATION_PENDING" };
export function loadActivityFeed(db: D1Database, limit: number, type: string | null): Promise<ActivityFeedResponse>;

export interface WorkspaceActivitySummary {
  id: string; name: string; slug: string; ownerEmail: string | null; memberCount: number; createdAt: number;
  lastActiveAt: number | null; lastWebAt: number | null; lastAppAt: number | null; lastLoginAt: number | null;
  lastTestCreatedAt: number | null; lastRunAt: number | null; lastRunStatus: "PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR" | null;
  lastAlertSentAt: number | null;
}
export type WorkspacesResponse = { workspaces: WorkspaceActivitySummary[] } | { unavailable: "MIGRATION_PENDING" };
export function loadWorkspaces(db: D1Database, limit: number): Promise<WorkspacesResponse>;
```

- [ ] **Step 1: Write failing itests**

Follow `apps/admin/src/server/db/queries.itest.ts` for the mechanics (fixed `NOW`, `env.DB.batch([...])` seeding) but use your own cleanup list inside each new itest file (`DELETE FROM activity_events`, `users`, `workspaces`, `workspace_members`). Seed: two users, two workspaces (one with two members, one deleted via `deleted_at`), and activity rows: `user.logged_in` (ws NULL), `web.page_viewed` (ws A, web), `app.screen_viewed` (ws A, app), `browser_test.created` (ws A), `browser_test.run_failed` (ws A, newer than a `browser_test.run_passed`), `alert.sent` (ws A), `incident.opened` (ws A, user NULL).

Assertions for `loadWorkspaces(db, 50)`: only the non-deleted workspace is listed; `memberCount` 2; `lastActiveAt` = max over rows with `user_id IS NOT NULL` (so the `incident.opened` timestamp is **not** it even if newer); `lastWebAt`/`lastAppAt` per source; `lastLoginAt` = max `user.logged_in` across **members of the workspace** (join `workspace_members` → `activity_events.user_id`); `lastTestCreatedAt`; `lastRunAt` + `lastRunStatus: "FAILED"`; `lastAlertSentAt`. Assertions for `loadActivityFeed(db, 50, null)`: newest first, actor resolved from `users`, workspace name resolved, `properties` parsed from JSON (null when absent); `loadActivityFeed(db, 50, "alert.sent")` returns only that type. Migration-pending test: `DROP TABLE activity_events` → both loaders return `{ unavailable: "MIGRATION_PENDING" }` (re-create the table afterwards by re-running the `0037` DDL inline, as `restoreRunnerSchema()` does in `queries.itest.ts`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @zenguy/admin test:integration -- src/server/db/activity.itest.ts src/server/db/workspaces.itest.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`workspaces.ts` — one statement, correlated subqueries over the indexes:

```sql
SELECT w.id, w.name, w.slug, w.created_at,
       owner.email AS owner_email,
       (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
       (SELECT MAX(e.occurred_at) FROM activity_events e WHERE e.workspace_id = w.id AND e.user_id IS NOT NULL) AS last_active_at,
       (SELECT MAX(e.occurred_at) FROM activity_events e WHERE e.workspace_id = w.id AND e.source = 'web') AS last_web_at,
       (SELECT MAX(e.occurred_at) FROM activity_events e WHERE e.workspace_id = w.id AND e.source = 'app') AS last_app_at,
       (SELECT MAX(e.occurred_at) FROM activity_events e
          JOIN workspace_members m ON m.user_id = e.user_id AND m.workspace_id = w.id
         WHERE e.type = 'user.logged_in') AS last_login_at,
       (SELECT MAX(e.occurred_at) FROM activity_events e WHERE e.workspace_id = w.id AND e.type = 'browser_test.created') AS last_test_created_at,
       (SELECT e.occurred_at FROM activity_events e WHERE e.workspace_id = w.id
          AND e.type IN ('browser_test.run_passed','browser_test.run_failed','browser_test.run_timed_out','browser_test.run_errored')
          ORDER BY e.occurred_at DESC LIMIT 1) AS last_run_at,
       (SELECT e.type FROM activity_events e WHERE e.workspace_id = w.id
          AND e.type IN ('browser_test.run_passed','browser_test.run_failed','browser_test.run_timed_out','browser_test.run_errored')
          ORDER BY e.occurred_at DESC LIMIT 1) AS last_run_type,
       (SELECT MAX(e.occurred_at) FROM activity_events e WHERE e.workspace_id = w.id AND e.type = 'alert.sent') AS last_alert_sent_at
FROM workspaces w
LEFT JOIN users owner ON owner.id = w.owner_user_id
WHERE w.deleted_at IS NULL
ORDER BY last_active_at DESC, w.created_at DESC
LIMIT ?
```

Map `last_run_type` → `lastRunStatus` (`run_passed` → `PASSED`, `run_failed` → `FAILED`, `run_timed_out` → `TIMEOUT`, `run_errored` → `SYSTEM_ERROR`, null → null). Wrap in `try/catch` returning `{ unavailable: "MIGRATION_PENDING" }` via `isMigrationPendingError`.

`activity.ts`:

```sql
SELECT e.id, e.type, e.occurred_at, e.source, e.resource_type, e.resource_id, e.properties_json,
       u.id AS actor_id, u.name AS actor_name, u.email AS actor_email,
       w.id AS workspace_id, w.name AS workspace_name
FROM activity_events e
LEFT JOIN users u ON u.id = e.user_id
LEFT JOIN workspaces w ON w.id = e.workspace_id
WHERE (? IS NULL OR e.type = ?)
ORDER BY e.occurred_at DESC, e.id DESC
LIMIT ?
```

Bind `(type, type, limit)`. Parse `properties_json` with a try/catch returning null on bad JSON. Same migration-pending wrapper.

- [ ] **Step 4: Run the itests and typecheck**

Run: `pnpm --filter @zenguy/admin test:integration -- src/server/db/activity.itest.ts src/server/db/workspaces.itest.ts && pnpm --filter @zenguy/admin typecheck`
Expected: PASS; clean.

---

### Task 13: Admin routes `GET /api/activity` and `GET /api/workspaces`

**Files:**
- Create: `apps/admin/src/server/routes/activity.ts`
- Test: `apps/admin/src/server/routes/activity.test.ts`
- Modify: `apps/admin/src/server/app.ts` (one hunk: mount `activityRoutes(...)` at `/api` next to `dataRoutes`)

**Interfaces:**
- Consumes: `loadActivityFeed`, `loadWorkspaces` (Task 12); `requireSession`, `AdminSessionStore`, `AppEnv`, `Clock`, `DEFAULT_LIST_LIMIT`, `MAX_LIST_LIMIT`, `AppError` — exactly as `routes/data.ts` uses them (read `data.ts` first and mirror its dependency shape; `app.ts` may be mid-rewrite by another session, so re-read it right before editing and keep the hunk to the mount lines).
- Produces: `activityRoutes(deps: DataRoutesDependencies & { loaders?: Partial<{ activity: typeof loadActivityFeed; workspaces: typeof loadWorkspaces }> }): Hono<AppEnv>` with `GET /activity?limit=&type=` → `{ data: ActivityFeedResponse }` and `GET /workspaces?limit=` → `{ data: WorkspacesResponse }`.

- [ ] **Step 1: Write the failing route test**

Mirror `apps/admin/src/server/routes/data.test.ts` (`fakeLoaders()`, `loggedIn()`): build the app with fake loaders returning canned data; assert `GET /api/activity` returns `{ data: { events: [...] } }`, `GET /api/activity?type=alert.sent` passes the type through to the loader, `?type=` with characters outside `[a-z_.]` or longer than 64 → 400, `?limit=500` → 400, and both routes answer 401 without a session. Add both paths to the auth-coverage loop if that loop is local to your new test file (do not edit `data.test.ts`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @zenguy/admin test -- src/server/routes/activity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the route and mount it**

```ts
// apps/admin/src/server/routes/activity.ts  (imports mirror data.ts)
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  type: z.string().regex(/^[a-z_]+\.[a-z_]+$/u).max(64).optional(),
});

export function activityRoutes(deps: ActivityRoutesDependencies): Hono<AppEnv> {
  const loaders = { activity: loadActivityFeed, workspaces: loadWorkspaces, ...deps.loaders };
  const guard = requireSession(deps);
  const app = new Hono<AppEnv>();
  app.get("/activity", guard, validateQuery, async (context) => {
    const query = context.req.valid("query");
    return context.json({ data: await loaders.activity(deps.db, query.limit, query.type ?? null) });
  });
  app.get("/workspaces", guard, validateQuery, async (context) =>
    context.json({ data: await loaders.workspaces(deps.db, context.req.valid("query").limit) }),
  );
  return app;
}
```

In `app.ts`, right after the line that mounts `dataRoutes` at `/api`, add `app.route("/api", activityRoutes({ ...same deps object... }));` (reuse the same dependency object the data routes receive; if `app.ts` builds it inline, extract nothing — just repeat the object literal).

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @zenguy/admin test && pnpm --filter @zenguy/admin typecheck`
Expected: PASS; clean. Then notify the session owner that the contract is live so the `admin-v2` client can mount it (the client is owned by another session; do not touch `apps/admin/src/client/**`).

---

### Task 15: Frontend activity library (route mapping + queue)

**Files:**
- Create: `apps/frontend/src/lib/activity/route-events.ts`
- Create: `apps/frontend/src/lib/activity/queue.ts`
- Test: `apps/frontend/src/lib/activity/route-events.test.ts`, `apps/frontend/src/lib/activity/queue.test.ts`

**Interfaces:**
- Consumes: `matchPath` from `react-router-dom`.
- Produces:

```ts
export interface ClientEvent {
  type: "web.page_viewed" | "browser_test.viewed" | "run.viewed" | "uptime_monitor.viewed" | "incident.viewed";
  workspaceId?: string;
  resourceId?: string;
  properties: { page: string };
}
export const ROUTE_EVENTS: ReadonlyArray<{ pattern: string; type: ClientEvent["type"]; resourceParam?: string }>;
export function visitEventFor(pathname: string): ClientEvent | null;

export interface ActivityQueueOptions {
  send: (events: ClientEvent[]) => Promise<void>;   // must never reject to the caller
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  debounceMs?: number;     // default 1000
  maxBatch?: number;       // default 25
  dedupeWindowMs?: number; // default 30000
}
export interface ActivityQueue { push(event: ClientEvent): void; flush(): void; clear(): void; size(): number }
export function createActivityQueue(options: ActivityQueueOptions): ActivityQueue;
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/frontend/src/lib/activity/route-events.test.ts
import { describe, expect, it } from "vitest";
import { ROUTE_EVENTS, visitEventFor } from "./route-events";

describe("visitEventFor", () => {
  it("maps resource pages to typed visits with the route pattern, never the concrete path", () => {
    expect(visitEventFor("/w/ws_1/tests/bt_9")).toEqual({
      type: "browser_test.viewed",
      workspaceId: "ws_1",
      resourceId: "bt_9",
      properties: { page: "/w/:wsId/tests/:testId" },
    });
    expect(visitEventFor("/w/ws_1/tests/bt_9/edit")?.properties.page).toBe("/w/:wsId/tests/:testId/edit");
    expect(visitEventFor("/w/ws_1/runs/run_2")).toMatchObject({ type: "run.viewed", resourceId: "run_2" });
    expect(visitEventFor("/w/ws_1/uptime/mon_3")).toMatchObject({ type: "uptime_monitor.viewed", resourceId: "mon_3" });
    expect(visitEventFor("/w/ws_1/uptime/mon_3/edit")).toMatchObject({ type: "uptime_monitor.viewed", resourceId: "mon_3" });
    expect(visitEventFor("/w/ws_1/incidents/inc_4")).toMatchObject({ type: "incident.viewed", resourceId: "inc_4" });
  });

  it("maps every other authenticated page to web.page_viewed", () => {
    expect(visitEventFor("/w/ws_1/overview")).toEqual({
      type: "web.page_viewed",
      workspaceId: "ws_1",
      properties: { page: "/w/:wsId/overview" },
    });
    expect(visitEventFor("/w/ws_1")).toMatchObject({ properties: { page: "/w/:wsId" } });
    expect(visitEventFor("/w/ws_1/tests/new")).toMatchObject({ type: "web.page_viewed", properties: { page: "/w/:wsId/tests/new" } });
    expect(visitEventFor("/onboarding/workspace")).toEqual({ type: "web.page_viewed", properties: { page: "/onboarding/workspace" } });
    expect(visitEventFor("/verify-pending")?.workspaceId).toBeUndefined();
    expect(visitEventFor("/w/ws_1/setup/billing")).toMatchObject({ workspaceId: "ws_1", properties: { page: "/w/:wsId/setup/billing" } });
  });

  it("ignores public and unknown paths", () => {
    for (const path of ["/signin", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/invitations/abc", "/grants/abc", "/privacy", "/terms", "/", "/nope"]) {
      expect(visitEventFor(path)).toBeNull();
    }
  });

  it("covers every authenticated route declared in App.tsx", () => {
    const expected = [
      "/verify-pending", "/complimentary", "/onboarding/workspace", "/w/:wsId/setup/billing",
      "/w/:wsId", "/w/:wsId/overview", "/w/:wsId/tests", "/w/:wsId/tests/new", "/w/:wsId/tests/:testId", "/w/:wsId/tests/:testId/edit",
      "/w/:wsId/runs/:runId", "/w/:wsId/uptime", "/w/:wsId/uptime/new", "/w/:wsId/uptime/:monitorId", "/w/:wsId/uptime/:monitorId/edit",
      "/w/:wsId/incidents", "/w/:wsId/incidents/:incidentId", "/w/:wsId/alerts", "/w/:wsId/alerts/sms-calls",
      "/w/:wsId/secrets", "/w/:wsId/members", "/w/:wsId/billing", "/w/:wsId/settings",
    ];
    expect(ROUTE_EVENTS.map((entry) => entry.pattern).sort()).toEqual(expected.sort());
  });
});
```

```ts
// apps/frontend/src/lib/activity/queue.test.ts
import { describe, expect, it, vi } from "vitest";
import { createActivityQueue } from "./queue";
import type { ClientEvent } from "./route-events";

const visit = (page: string, resourceId?: string): ClientEvent => ({
  type: resourceId ? "browser_test.viewed" : "web.page_viewed",
  workspaceId: "ws_1",
  ...(resourceId ? { resourceId } : {}),
  properties: { page },
});

function harness() {
  let time = 1_000;
  const timers: Array<{ fn: () => void; at: number }> = [];
  const sent: ClientEvent[][] = [];
  const queue = createActivityQueue({
    send: async (events) => { sent.push(events); },
    now: () => time,
    setTimer: (fn, ms) => { const handle = { fn, at: time + ms }; timers.push(handle); return handle; },
    clearTimer: (handle) => { const index = timers.indexOf(handle as never); if (index >= 0) timers.splice(index, 1); },
  });
  const advance = (ms: number) => {
    time += ms;
    for (const timer of [...timers]) if (timer.at <= time) { timers.splice(timers.indexOf(timer), 1); timer.fn(); }
  };
  return { queue, sent, advance, setTime: (value: number) => { time = value; } };
}

describe("activity queue", () => {
  it("debounces and sends one batch", () => {
    const { queue, sent, advance } = harness();
    queue.push(visit("/w/:wsId/overview"));
    queue.push(visit("/w/:wsId/tests"));
    expect(sent).toEqual([]);
    advance(999);
    expect(sent).toEqual([]);
    advance(1);
    expect(sent).toEqual([[visit("/w/:wsId/overview"), visit("/w/:wsId/tests")]]);
  });

  it("drops a repeat of the same visit inside the dedupe window", () => {
    const { queue, sent, advance } = harness();
    queue.push(visit("/w/:wsId/tests/:testId", "bt_1"));
    queue.push(visit("/w/:wsId/tests/:testId", "bt_1"));
    advance(1_000);
    expect(sent[0]).toHaveLength(1);
    advance(29_000);
    queue.push(visit("/w/:wsId/tests/:testId", "bt_1"));
    advance(1_000);
    expect(sent).toHaveLength(1);
    advance(1_000);
    queue.push(visit("/w/:wsId/tests/:testId", "bt_1"));
    advance(1_000);
    expect(sent).toHaveLength(2);
  });

  it("flushes immediately when the batch is full, on flush(), and discards on clear()", () => {
    const { queue, sent, advance } = harness();
    for (let index = 0; index < 25; index += 1) queue.push(visit(`/p${index}`));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(25);
    queue.push(visit("/late"));
    queue.flush();
    expect(sent).toHaveLength(2);
    queue.push(visit("/never"));
    queue.clear();
    advance(5_000);
    expect(sent).toHaveLength(2);
    expect(queue.size()).toBe(0);
  });

  it("swallows transport failures", async () => {
    const send = vi.fn(async () => { throw new Error("offline"); });
    const queue = createActivityQueue({ send, now: () => 0, setTimer: (fn) => { fn(); return 0; }, clearTimer: () => undefined });
    expect(() => queue.push(visit("/x"))).not.toThrow();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @zenguy/frontend test -- src/lib/activity`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// apps/frontend/src/lib/activity/route-events.ts
import { matchPath } from "react-router-dom";

export type ClientEventType =
  | "web.page_viewed"
  | "browser_test.viewed"
  | "run.viewed"
  | "uptime_monitor.viewed"
  | "incident.viewed";

export interface ClientEvent {
  type: ClientEventType;
  workspaceId?: string;
  resourceId?: string;
  properties: { page: string };
}

interface RouteEvent {
  pattern: string;
  type: ClientEventType;
  resourceParam?: string;
}

/**
 * Every authenticated route in App.tsx. Public routes are deliberately absent:
 * nothing is recorded before sign-in. Add a row when you add a page.
 */
export const ROUTE_EVENTS: ReadonlyArray<RouteEvent> = [
  { pattern: "/verify-pending", type: "web.page_viewed" },
  { pattern: "/complimentary", type: "web.page_viewed" },
  { pattern: "/onboarding/workspace", type: "web.page_viewed" },
  { pattern: "/w/:wsId/setup/billing", type: "web.page_viewed" },
  { pattern: "/w/:wsId", type: "web.page_viewed" },
  { pattern: "/w/:wsId/overview", type: "web.page_viewed" },
  { pattern: "/w/:wsId/tests", type: "web.page_viewed" },
  { pattern: "/w/:wsId/tests/new", type: "web.page_viewed" },
  { pattern: "/w/:wsId/tests/:testId", type: "browser_test.viewed", resourceParam: "testId" },
  { pattern: "/w/:wsId/tests/:testId/edit", type: "browser_test.viewed", resourceParam: "testId" },
  { pattern: "/w/:wsId/runs/:runId", type: "run.viewed", resourceParam: "runId" },
  { pattern: "/w/:wsId/uptime", type: "web.page_viewed" },
  { pattern: "/w/:wsId/uptime/new", type: "web.page_viewed" },
  { pattern: "/w/:wsId/uptime/:monitorId", type: "uptime_monitor.viewed", resourceParam: "monitorId" },
  { pattern: "/w/:wsId/uptime/:monitorId/edit", type: "uptime_monitor.viewed", resourceParam: "monitorId" },
  { pattern: "/w/:wsId/incidents", type: "web.page_viewed" },
  { pattern: "/w/:wsId/incidents/:incidentId", type: "incident.viewed", resourceParam: "incidentId" },
  { pattern: "/w/:wsId/alerts", type: "web.page_viewed" },
  { pattern: "/w/:wsId/alerts/sms-calls", type: "web.page_viewed" },
  { pattern: "/w/:wsId/secrets", type: "web.page_viewed" },
  { pattern: "/w/:wsId/members", type: "web.page_viewed" },
  { pattern: "/w/:wsId/billing", type: "web.page_viewed" },
  { pattern: "/w/:wsId/settings", type: "web.page_viewed" },
];

export function visitEventFor(pathname: string): ClientEvent | null {
  for (const route of ROUTE_EVENTS) {
    const match = matchPath({ path: route.pattern, end: true }, pathname);
    if (match === null) continue;
    const workspaceId = match.params.wsId;
    const resourceId = route.resourceParam ? match.params[route.resourceParam] : undefined;
    return {
      type: route.type,
      ...(workspaceId ? { workspaceId } : {}),
      ...(resourceId ? { resourceId } : {}),
      properties: { page: route.pattern },
    };
  }
  return null;
}
```

Note: `matchPath` with `"/w/:wsId"` and `end: true` does not match `/w/ws_1/overview`, so order does not matter; `/w/:wsId/tests/new` is listed before `/w/:wsId/tests/:testId` anyway so `new` is never treated as an id.

```ts
// apps/frontend/src/lib/activity/queue.ts
import type { ClientEvent } from "./route-events";

export interface ActivityQueueOptions {
  send: (events: ClientEvent[]) => Promise<void>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  debounceMs?: number;
  maxBatch?: number;
  dedupeWindowMs?: number;
}

export interface ActivityQueue {
  push(event: ClientEvent): void;
  flush(): void;
  clear(): void;
  size(): number;
}

function dedupeKey(event: ClientEvent): string {
  return `${event.type}|${event.workspaceId ?? ""}|${event.resourceId ?? ""}|${event.properties.page}`;
}

/** Batches client events: debounce, size cap, dedupe window, best-effort send. */
export function createActivityQueue(options: ActivityQueueOptions): ActivityQueue {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const debounceMs = options.debounceMs ?? 1_000;
  const maxBatch = options.maxBatch ?? 25;
  const dedupeWindowMs = options.dedupeWindowMs ?? 30_000;

  let pending: ClientEvent[] = [];
  let timer: unknown = null;
  const lastSeen = new Map<string, number>();

  const flush = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    void options.send(batch).catch(() => undefined);
  };

  return {
    push(event) {
      const key = dedupeKey(event);
      const at = now();
      const previous = lastSeen.get(key);
      if (previous !== undefined && at - previous < dedupeWindowMs) return;
      lastSeen.set(key, at);
      pending.push(event);
      if (pending.length >= maxBatch) {
        flush();
        return;
      }
      if (timer === null) timer = setTimer(flush, debounceMs);
    },
    flush,
    clear() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = [];
      lastSeen.clear();
    },
    size: () => pending.length,
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @zenguy/frontend test -- src/lib/activity && pnpm --filter @zenguy/frontend typecheck`
Expected: PASS; clean.

---

### Task 16: Frontend integration (`apiBeacon`, `ActivityTracker`, `RequireAuth`)

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (add `apiBeacon`)
- Create: `apps/frontend/src/components/ActivityTracker.tsx`
- Modify: `apps/frontend/src/App.tsx` (render `<ActivityTracker />` inside `RequireAuth`)
- Test: `apps/frontend/src/components/ActivityTracker.test.ts` (pure helper test)

**Interfaces:**
- Consumes: Task 15 library; `apiUrl`, `requestHeaders` (module-private in `api.ts` — `apiBeacon` lives in the same module); `useAuth()` from `src/contexts/AuthContext.tsx`; `useLocation` from react-router.
- Produces: `export async function apiBeacon(path: string, body: unknown): Promise<void>` (keepalive POST, never throws, no retry, no sign-out side effects); `export function ActivityTracker(): null`; `export function shouldTrack(status: AuthStatus): boolean` (pure helper exported from the component file for the test).

- [ ] **Step 1: Write the helper test**

```ts
// apps/frontend/src/components/ActivityTracker.test.ts
import { describe, expect, it } from "vitest";
import { shouldTrack } from "./ActivityTracker";

describe("shouldTrack", () => {
  it("tracks only signed-in sessions", () => {
    expect(shouldTrack("signedIn")).toBe(true);
    expect(shouldTrack("signedOut")).toBe(false);
    expect(shouldTrack("loading")).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `apiBeacon`**

In `api.ts`, after `apiGetBlob` (end of the exported helpers):

```ts
/**
 * Best-effort POST for telemetry: keeps the request alive across navigations,
 * never retries, never throws and never signs the session out.
 */
export async function apiBeacon(path: string, body: unknown): Promise<void> {
  if (!path.startsWith("/api/")) throw new Error("API paths must start with /api/");
  try {
    await fetch(apiUrl(path), {
      body: JSON.stringify(body),
      credentials: "include",
      headers: requestHeaders(true),
      keepalive: true,
      method: "POST",
    });
  } catch {
    // Telemetry is disposable.
  }
}
```

- [ ] **Step 3: Implement the tracker**

```tsx
// apps/frontend/src/components/ActivityTracker.tsx
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { apiBeacon } from "../lib/api";
import { createActivityQueue, type ActivityQueue } from "../lib/activity/queue";
import { visitEventFor } from "../lib/activity/route-events";

type AuthStatus = ReturnType<typeof useAuth>["status"];

export function shouldTrack(status: AuthStatus): boolean {
  return status === "signedIn";
}

/** Reports page visits for the signed-in user. Renders nothing. */
export function ActivityTracker() {
  const { status } = useAuth();
  const location = useLocation();
  const queueRef = useRef<ActivityQueue | null>(null);

  if (queueRef.current === null) {
    queueRef.current = createActivityQueue({
      send: (events) => apiBeacon("/api/me/events", { events }),
    });
  }

  useEffect(() => {
    const queue = queueRef.current;
    if (queue === null) return;
    if (!shouldTrack(status)) {
      queue.clear();
      return;
    }
    const flush = () => {
      if (document.visibilityState === "hidden") queue.flush();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", queue.flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", queue.flush);
    };
  }, [status]);

  useEffect(() => {
    if (!shouldTrack(status)) return;
    const event = visitEventFor(location.pathname);
    if (event !== null) queueRef.current?.push(event);
  }, [status, location.pathname]);

  return null;
}
```

In `App.tsx`, change the last line of `RequireAuth` to render the tracker alongside the outlet:

```tsx
  return (
    <>
      <ActivityTracker />
      {children ?? <Outlet />}
    </>
  );
```

with `import { ActivityTracker } from "./components/ActivityTracker";` and a one-line comment above `ROUTE_EVENTS`-dependent code: `// New authenticated routes must also be listed in src/lib/activity/route-events.ts.` placed above `AppRoutes`.

- [ ] **Step 4: Run tests, typecheck and build**

Run: `pnpm --filter @zenguy/frontend test && pnpm --filter @zenguy/frontend typecheck && pnpm --filter @zenguy/frontend build`
Expected: PASS; clean; build succeeds.

---

### Task 17: App activity library (screen mapping + queue)

**Files:**
- Create: `apps/app/src/lib/activity/screen-events.ts`
- Create: `apps/app/src/lib/activity/queue.ts`
- Test: `apps/app/src/lib/activity/screen-events.test.ts`, `apps/app/src/lib/activity/queue.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (standalone pnpm root).
- Produces:

```ts
export type ClientEventType = "app.screen_viewed" | "app.opened" | "browser_test.viewed" | "run.viewed" | "uptime_monitor.viewed" | "incident.viewed";
export interface ClientEvent { type: ClientEventType; workspaceId?: string; resourceId?: string; properties: Record<string, string | number | boolean> }
export function screenPattern(segments: readonly string[]): string;            // drops "(group)" segments → "/w/[wsId]/tests/[testId]"
export function visitEventFor(segments: readonly string[], params: Record<string, string | string[] | undefined>, meta: { appVersion: string | null }): ClientEvent | null;
export function appOpenedEvent(meta: { appVersion: string | null }): ClientEvent;
export function createActivityQueue(options: ActivityQueueOptions): ActivityQueue;  // identical contract to the frontend queue
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/app/src/lib/activity/screen-events.test.ts
import { describe, expect, it } from "@jest/globals";
import { appOpenedEvent, screenPattern, visitEventFor } from "./screen-events";

const meta = { appVersion: "1.2.0" };

describe("screenPattern", () => {
  it("drops route groups and keeps dynamic segments", () => {
    expect(screenPattern(["w", "[wsId]", "(tabs)", "(tests)", "tests", "[testId]"])).toBe("/w/[wsId]/tests/[testId]");
    expect(screenPattern(["(auth)", "sign-in"])).toBe("/sign-in");
    expect(screenPattern([])).toBe("/");
  });
});

describe("visitEventFor", () => {
  it("maps resource screens to typed visits", () => {
    expect(
      visitEventFor(["w", "[wsId]", "(tabs)", "(tests)", "tests", "[testId]"], { wsId: "ws_1", testId: "bt_9" }, meta),
    ).toEqual({
      type: "browser_test.viewed",
      workspaceId: "ws_1",
      resourceId: "bt_9",
      properties: { screen: "/w/[wsId]/tests/[testId]", appVersion: "1.2.0", platform: "ios" },
    });
    expect(visitEventFor(["w", "[wsId]", "(tabs)", "(tests)", "tests", "[testId]", "edit"], { wsId: "ws_1", testId: "bt_9" }, meta)?.type).toBe("browser_test.viewed");
    expect(visitEventFor(["w", "[wsId]", "(tabs)", "(tests)", "runs", "[runId]"], { wsId: "ws_1", runId: "run_2" }, meta)).toMatchObject({ type: "run.viewed", resourceId: "run_2" });
    expect(visitEventFor(["w", "[wsId]", "(tabs)", "(uptime)", "uptime", "[monitorId]"], { wsId: "ws_1", monitorId: "mon_3" }, meta)).toMatchObject({ type: "uptime_monitor.viewed", resourceId: "mon_3" });
    expect(visitEventFor(["w", "[wsId]", "(tabs)", "(incidents)", "incidents", "[incidentId]"], { wsId: "ws_1", incidentId: "inc_4" }, meta)).toMatchObject({ type: "incident.viewed", resourceId: "inc_4" });
  });

  it("maps other authenticated screens to app.screen_viewed", () => {
    expect(visitEventFor(["w", "[wsId]", "(tabs)", "(overview)", "overview"], { wsId: "ws_1" }, meta)).toEqual({
      type: "app.screen_viewed",
      workspaceId: "ws_1",
      properties: { screen: "/w/[wsId]/overview", appVersion: "1.2.0", platform: "ios" },
    });
    expect(visitEventFor(["onboarding", "workspace"], {}, { appVersion: null })).toEqual({
      type: "app.screen_viewed",
      properties: { screen: "/onboarding/workspace", appVersion: "", platform: "ios" },
    });
    expect(visitEventFor(["verify-pending"], {}, meta)?.type).toBe("app.screen_viewed");
  });

  it("ignores public screens", () => {
    for (const segments of [["(auth)", "sign-in"], ["(auth)", "sign-up"], ["(auth)", "forgot-password"], ["(auth)", "reset-password"], ["privacy"], ["terms"], ["verify-email"], ["invitations", "[token]"], []]) {
      expect(visitEventFor(segments, {}, meta)).toBeNull();
    }
  });
});

describe("appOpenedEvent", () => {
  it("carries version and platform", () => {
    expect(appOpenedEvent(meta)).toEqual({ type: "app.opened", properties: { appVersion: "1.2.0", platform: "ios" } });
  });
});
```

`queue.test.ts`: port the frontend queue tests verbatim, replacing the vitest import with `import { describe, expect, it, jest } from "@jest/globals";` and `vi.fn` with `jest.fn`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --dir apps/app test -- src/lib/activity`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// apps/app/src/lib/activity/screen-events.ts
export type ClientEventType =
  | "app.screen_viewed"
  | "app.opened"
  | "browser_test.viewed"
  | "run.viewed"
  | "uptime_monitor.viewed"
  | "incident.viewed";

export interface ClientEvent {
  type: ClientEventType;
  workspaceId?: string;
  resourceId?: string;
  properties: Record<string, string | number | boolean>;
}

export interface ClientMeta {
  appVersion: string | null;
}

const PUBLIC_SCREENS = new Set([
  "/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password",
  "/privacy", "/terms", "/verify-email", "/invitations/[token]",
]);

const RESOURCE_SCREENS: ReadonlyArray<{ screen: string; type: ClientEventType; param: string }> = [
  { screen: "/w/[wsId]/tests/[testId]", type: "browser_test.viewed", param: "testId" },
  { screen: "/w/[wsId]/tests/[testId]/edit", type: "browser_test.viewed", param: "testId" },
  { screen: "/w/[wsId]/runs/[runId]", type: "run.viewed", param: "runId" },
  { screen: "/w/[wsId]/uptime/[monitorId]", type: "uptime_monitor.viewed", param: "monitorId" },
  { screen: "/w/[wsId]/uptime/[monitorId]/edit", type: "uptime_monitor.viewed", param: "monitorId" },
  { screen: "/w/[wsId]/incidents/[incidentId]", type: "incident.viewed", param: "incidentId" },
];

/** `["w","[wsId]","(tabs)","(tests)","tests","[testId]"]` → `/w/[wsId]/tests/[testId]`. */
export function screenPattern(segments: readonly string[]): string {
  const visible = segments.filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${visible.join("/")}`;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function baseProperties(screen: string, meta: ClientMeta): Record<string, string> {
  return { screen, appVersion: meta.appVersion ?? "", platform: "ios" };
}

export function visitEventFor(
  segments: readonly string[],
  params: Record<string, string | string[] | undefined>,
  meta: ClientMeta,
): ClientEvent | null {
  const screen = screenPattern(segments);
  if (PUBLIC_SCREENS.has(screen)) return null;
  const workspaceId = single(params.wsId);
  const resource = RESOURCE_SCREENS.find((entry) => entry.screen === screen);
  if (resource !== undefined) {
    const resourceId = single(params[resource.param]);
    if (workspaceId === undefined || resourceId === undefined) return null;
    return { type: resource.type, workspaceId, resourceId, properties: baseProperties(screen, meta) };
  }
  return {
    type: "app.screen_viewed",
    ...(workspaceId === undefined ? {} : { workspaceId }),
    properties: baseProperties(screen, meta),
  };
}

export function appOpenedEvent(meta: ClientMeta): ClientEvent {
  return { type: "app.opened", properties: { appVersion: meta.appVersion ?? "", platform: "ios" } };
}
```

`queue.ts`: copy the frontend implementation from Task 15 verbatim, importing `ClientEvent` from `./screen-events` and using `dedupeKey = type|workspaceId|resourceId|properties.screen` (fall back to `""` when `screen` is absent, e.g. `app.opened`).

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --dir apps/app test -- src/lib/activity && pnpm --dir apps/app typecheck`
Expected: PASS; clean.

---

### Task 18: App integration (`ActivityTracker`, transport, `_layout.tsx`)

**Files:**
- Create: `apps/app/src/api/events.ts`
- Create: `apps/app/src/components/ActivityTracker.tsx`
- Test: `apps/app/src/components/ActivityTracker.test.tsx`
- Modify: `apps/app/app/_layout.tsx` (render `<ActivityTracker />` next to `<UpdateGate />`)

**Interfaces:**
- Consumes: Task 17 library; `apiPost` from `src/lib/api.ts`; `authEvents.onSignedOut` (`src/lib/api.ts`); `onBeforeSignOut` (`src/lib/session-hooks.ts`); `useAuth()` (`src/contexts/AuthContext.tsx`); `useSegments`, `useGlobalSearchParams` from `expo-router`; `AppState` from `react-native`; `Constants.expoConfig?.version` from `expo-constants` (as `UpdateGate.tsx` does).
- Produces: `export function sendActivityEvents(events: ClientEvent[]): Promise<void>` (wraps `apiPost("/api/me/events", { events })`, swallows every error); `export function ActivityTracker(): null`.

- [ ] **Step 1: Write the failing component test**

```tsx
// apps/app/src/components/ActivityTracker.test.tsx
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render } from "@testing-library/react-native";
import React from "react";

const mockSegments = { current: ["w", "[wsId]", "(tabs)", "(overview)", "overview"] as string[] };
const mockParams = { current: { wsId: "ws_1" } as Record<string, string> };
const mockStatus = { current: "signedIn" as "signedIn" | "signedOut" | "loading" | "unavailable" };
const send = jest.fn(async () => undefined);

jest.mock("expo-router", () => ({
  useSegments: () => mockSegments.current,
  useGlobalSearchParams: () => mockParams.current,
}));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ status: mockStatus.current }) }));
jest.mock("@/api/events", () => ({ sendActivityEvents: (events: unknown) => send(events as never) }));

import { ActivityTracker } from "./ActivityTracker";

describe("ActivityTracker", () => {
  beforeEach(() => { send.mockClear(); jest.useFakeTimers(); });

  it("reports the current screen for a signed-in user", () => {
    render(<ActivityTracker />);
    jest.advanceTimersByTime(1_000);
    expect(send).toHaveBeenCalledWith([
      expect.objectContaining({ type: "app.screen_viewed", workspaceId: "ws_1", properties: expect.objectContaining({ screen: "/w/[wsId]/overview", platform: "ios" }) }),
    ]);
  });

  it("reports nothing while signed out", () => {
    mockStatus.current = "signedOut";
    render(<ActivityTracker />);
    jest.advanceTimersByTime(1_000);
    expect(send).not.toHaveBeenCalled();
    mockStatus.current = "signedIn";
  });
});
```

Check `jest.setup.ts` for how `expo-constants`/`react-native` are mocked; add `jest.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }))` in the test if needed.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --dir apps/app test -- src/components/ActivityTracker.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/app/src/api/events.ts
import type { ClientEvent } from "@/lib/activity/screen-events";
import { apiPost } from "@/lib/api";

/** Best effort: visits are disposable, and a failure must never surface in the UI. */
export async function sendActivityEvents(events: ClientEvent[]): Promise<void> {
  try {
    await apiPost("/api/me/events", { events });
  } catch {
    // Includes SessionSupersededError during sign-out and workspace switches.
  }
}
```

```tsx
// apps/app/src/components/ActivityTracker.tsx
import Constants from "expo-constants";
import { useGlobalSearchParams, useSegments } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { sendActivityEvents } from "@/api/events";
import { useAuth } from "@/contexts/AuthContext";
import { createActivityQueue, type ActivityQueue } from "@/lib/activity/queue";
import { appOpenedEvent, visitEventFor } from "@/lib/activity/screen-events";
import { authEvents } from "@/lib/api";
import { onBeforeSignOut } from "@/lib/session-hooks";

const meta = { appVersion: Constants.expoConfig?.version ?? null };

/** Reports screen visits and foreground transitions for the signed-in user. Renders nothing. */
export function ActivityTracker() {
  const { status } = useAuth();
  const segments = useSegments();
  const params = useGlobalSearchParams<Record<string, string>>();
  const queueRef = useRef<ActivityQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = createActivityQueue({ send: sendActivityEvents });
  }
  const tracking = status === "signedIn";

  useEffect(() => {
    const queue = queueRef.current;
    if (queue === null) return;
    if (!tracking) {
      queue.clear();
      return;
    }
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") queue.push(appOpenedEvent(meta));
      if (state === "background") queue.flush();
    });
    const unsubscribeSignOut = authEvents.onSignedOut(() => queue.clear());
    const unsubscribeBefore = onBeforeSignOut(async () => queue.flush());
    return () => {
      subscription.remove();
      unsubscribeSignOut();
      unsubscribeBefore();
    };
  }, [tracking]);

  const screenKey = `${segments.join("/")}|${JSON.stringify(params)}`;
  useEffect(() => {
    if (!tracking) return;
    const event = visitEventFor(segments, params, meta);
    if (event !== null) queueRef.current?.push(event);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- segments/params identity changes every render; screenKey captures their content
  }, [tracking, screenKey]);

  return null;
}
```

In `app/_layout.tsx`, add `import { ActivityTracker } from "@/components/ActivityTracker";` and render `<ActivityTracker />` immediately after `<UpdateGate />` inside `ProtectedAppContent`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm --dir apps/app test && pnpm --dir apps/app typecheck && pnpm --dir apps/app lint`
Expected: PASS; clean.

---

### Task 19: Review and fix

**Files:** anything created or modified by Tasks 1–18.

- [ ] **Step 1: Spec compliance review** — read the spec and diff every section against the code: catalog coverage (§5 table), bridge and explicit points (§6), endpoint validation and security (§7, §12), client behaviour (§8, §9), admin loaders (§10), retention and deletion (§11). Report gaps with file paths.
- [ ] **Step 2: Bug hunt** — concurrency (membership memo), D1 batch limits, `keepalive` body size (< 64 KB: 25 events × ≤ 20 × 200 chars is fine), StrictMode double effects (dedupe covers it), AppLock, sign-out races, purge loop termination, index usage of the admin queries (`EXPLAIN QUERY PLAN` on a local D1 if in doubt).
- [ ] **Step 3: Fix** confirmed findings, rerun the affected gates: API (`typecheck`, `test`, `test:integration`), admin (`test`, `test:integration`, `typecheck`), frontend (`test`, `typecheck`, `build`), app (`test`, `typecheck`, `lint`).

---

## Self-review against the spec

- §4 schema/indexes → Task 2. §5 catalog → Task 1 (all 61 types; client allowlist 7). §6.1 `TrackEvent` → Task 3. §6.2 bridge → Task 5. §6.3 explicit points → Tasks 6, 7, 8 (+ wiring test Task 10). §6.4 `source` rules → Tasks 3, 6, 8, 9. §7 endpoint → Tasks 4, 9. §8 webapp → Tasks 15, 16. §9 app → Tasks 17, 18. §10 admin → Tasks 12, 13 (client UI deferred to the `admin-v2` owner by agreement). §11 retention/deletion → Task 11 (+ wiring Task 10). §12 privacy → Tasks 3, 9, 15, 17. §13 tests → per task. §14 deployment → session owner after Task 19.
- Type names used consistently: `TrackEvent`/`TrackEventInput`/`buildActivityEvent` (Task 3) consumed by 4, 5, 6, 7, 8, 10; `ActivityEventRepo.deleteOlderThan(before, types, limit)` (Task 1/2) consumed by 11; `activityRoutes` (Task 9) mounted in 9, tracked in 10; `ClientEvent` shapes differ between frontend (`properties: { page }`) and app (`properties: Record<…>`) on purpose — they are separate packages.
