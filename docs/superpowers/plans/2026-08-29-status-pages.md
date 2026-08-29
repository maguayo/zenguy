# Status Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public per-workspace status pages at `app.zenguy.com/status/<slug>` with an authenticated builder, incident-derived 90-day availability, and manual public incident updates.

**Architecture:** New `status_pages` / `status_page_items` / `incident_updates` D1 tables; use cases in `apps/api/src/application/status_pages` following the existing class-per-file pattern; an SSR public route rendered with `hono/html` (no build changes), edge-cached 60 s and IP-rate-limited; builder UI in the React SPA. History derives from the `incidents` table (never purged) — no rollup tables.

**Tech Stack:** Hono 4 (`hono/html`), Cloudflare Workers + D1, zod, vitest (+ vitest-pool-workers itests), React 18 + react-router + @tanstack/react-query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-29-status-pages-design.md`

## Global Constraints

- **Concurrent session warning:** another session has UNCOMMITTED Google-OAuth work in `apps/api/src/app.ts`, `apps/api/wrangler.jsonc`, `apps/api/src/wrangler_config.test.ts`, `apps/api/src/test/fakes/repos.ts`, `apps/api/src/test/helpers.ts`, `shared/config.ts`, `http/routes/auth.ts`, `http/cookies.ts`, `http/middleware/security_headers.ts`. You may EDIT those files (changes are in different regions), but **never `git add` a file that still contains foreign uncommitted hunks** — committing it would mix their work into your commit. Before each commit run `git status` + `git diff <file>`; if a shared file is still dirty with foreign hunks, leave it out of the commit and record it in the final task's "pending commits" note. At Task 8 start, check `ListAgents`/peer sessions and ask the OAuth session to commit if it is alive.
- Never `git push` (production deploys from main). Commit locally only.
- Commit messages follow repo style: `api: …` / `frontend: …` / `docs: …`, lowercase, Spanish, plus the standard `Co-Authored-By: Claude …` / `Claude-Session: …` trailers.
- All code, identifiers, and user-facing page strings in **English** (public page copy is English-only in v1, per spec).
- Test commands (never insert `--` before the path): unit `pnpm --filter @zenguy/api test <path>`, integration `pnpm --filter @zenguy/api test:integration <path>`, frontend `pnpm --filter @zenguy/frontend test <path>`, typecheck `pnpm --filter @zenguy/api typecheck` / `pnpm --filter @zenguy/frontend typecheck`.
- Copy exact limits from the spec: 5 pages/workspace, 50 items/page, 2000-char updates, 90-day history, 15-day recent-incident window, slug `^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$` (3–63), reserved slugs `json, preview, assets, api, app, admin, www, status, zenguy, docs, help, staging`.
- Never publish in any public payload: monitored URLs, `start_url`, instructions, methods/headers/bodies, `failure_reason`, `response_excerpt`, `incident_events`, internal resource ids, emails, billing data.
- Public routes never read or set cookies and never require auth.
- Follow the neighbor pattern rule: when a step says "mirror file X", open X first and copy its structure (imports, error handling, test harness) rather than inventing a new one.

## File Structure

```
apps/api/
  migrations/0049_status_pages.sql                         (new)
  src/domain/status_pages/types.ts                         (new)
  src/domain/status_pages/repo.ts                          (new)
  src/domain/status_pages/rules.ts                         (new: zod schemas + slug rules)
  src/domain/workspaces/permissions.ts                     (modify: +status_pages.manage)
  src/domain/audit/actions.ts                              (modify: +8 actions)
  src/domain/activity/catalog.ts                           (modify: +8 events + bridge)
  src/domain/incidents/repo.ts                             (modify: +listForPublicWindow)
  src/domain/uptime/repo.ts                                (modify: +findByIds)
  src/domain/browser_tests/repo.ts                         (modify: +findByIds, +testsWithFinishedRuns)
  src/shared/ids.ts                                        (modify: +sp/spi/iu prefixes)
  src/shared/constants.ts                                  (modify: +limits, +RATE_LIMITS.status_page)
  src/infrastructure/db/status_page_repo.ts                (new: pages + items repos)
  src/infrastructure/db/status_page_repos.itest.ts         (new)
  src/infrastructure/db/incident_update_repo.ts            (new)
  src/infrastructure/db/incident_repo.ts                   (modify)
  src/infrastructure/db/monitor_repo.ts                    (modify)
  src/infrastructure/db/browser_test_repo.ts               (modify)
  src/infrastructure/db/run_repo.ts                        (modify)
  src/infrastructure/db/workspace_deletion_repo.ts         (modify: purge 3 tables)
  src/application/status_pages/create_status_page.ts       (new)  + .test.ts
  src/application/status_pages/update_status_page.ts       (new)  + .test.ts
  src/application/status_pages/publish_status_page.ts      (new)  + .test.ts
  src/application/status_pages/delete_status_page.ts       (new)  + .test.ts
  src/application/status_pages/list_status_pages.ts        (new)  + .test.ts (folded into others)
  src/application/status_pages/get_status_page.ts          (new)
  src/application/status_pages/add_item.ts                 (new)  + .test.ts
  src/application/status_pages/update_item.ts              (new)  + .test.ts
  src/application/status_pages/remove_item.ts              (new)
  src/application/status_pages/reorder_items.ts            (new)  + .test.ts
  src/application/status_pages/availability.ts             (new)  + .test.ts
  src/application/status_pages/get_public_status_page.ts   (new)  + .test.ts
  src/application/status_pages/types.ts                    (new: outputs)
  src/application/incidents/post_incident_update.ts        (new)  + .test.ts
  src/application/incidents/delete_incident_update.ts      (new)  + .test.ts
  src/application/uptime/delete_monitor.ts                 (modify: remove page items)
  src/application/browser_tests/delete_browser_test.ts     (modify: remove page items)
  src/http/views/status_page_html.ts                       (new)  + .test.ts
  src/http/presenters/status_page.ts                       (new)
  src/http/routes/status_pages.ts                          (new: admin CRUD + preview)
  src/http/routes/status_page_routes.itest.ts              (new)
  src/http/routes/status_public.ts                         (new: SSR + JSON)
  src/http/routes/status_public_routes.itest.ts            (new)
  src/http/routes/incident_updates.ts                      (new)
  src/http/routes/incident_update_routes.itest.ts          (new)
  src/http/routes/rbac_matrix.itest.ts                     (modify)
  src/http/routes/cross_tenant.itest.ts                    (modify)
  src/app.ts                                               (modify: wiring + mounts)   [SHARED-DIRTY]
  src/test/fakes/status_page_repos.ts                      (new)
  wrangler.jsonc                                           (modify: /status/* routes)  [SHARED-DIRTY]
  src/wrangler_config.test.ts                              (modify)                    [SHARED-DIRTY]
apps/frontend/
  src/lib/permissions.ts + permissions.test.ts             (modify: +status_pages.manage)
  src/lib/api.ts                                           (modify: +apiGetText)
  src/api/types.ts                                         (modify: +status page types)
  src/api/status_pages.ts                                  (new)  + .test.ts
  src/api/incidents.ts                                     (modify: +updates calls)
  src/pages/status_pages/StatusPagesListPage.tsx           (new)  + .test.tsx
  src/pages/status_pages/StatusPageEditorPage.tsx          (new)  + .test.tsx
  src/pages/incidents/IncidentDetailPage.tsx               (modify: public updates panel)
  src/components/Sidebar.tsx                               (modify: nav item)
  src/App.tsx                                              (modify: routes)
README.md                                                  (modify: feature bullet)
```

---

### Task 1: Migration, domain types, D1 repos, fakes

**Files:**
- Create: `apps/api/migrations/0049_status_pages.sql`
- Create: `apps/api/src/domain/status_pages/types.ts`, `apps/api/src/domain/status_pages/repo.ts`
- Modify: `apps/api/src/shared/ids.ts`, `apps/api/src/shared/constants.ts`, `apps/api/src/domain/workspaces/permissions.ts`
- Create: `apps/api/src/infrastructure/db/status_page_repo.ts`, `apps/api/src/infrastructure/db/incident_update_repo.ts`
- Create: `apps/api/src/test/fakes/status_page_repos.ts`
- Test: `apps/api/src/infrastructure/db/status_page_repos.itest.ts`

**Interfaces:**
- Consumes: `all/one/run/batch` helpers from `infrastructure/db/d1.ts`; `Cursor`-free (no pagination needed — a workspace has ≤5 pages).
- Produces (later tasks rely on these exact names):

```ts
// domain/status_pages/types.ts
export type StatusPageTheme = "LIGHT" | "DARK" | "SYSTEM";
export type StatusPageResourceType = "BROWSER_TEST" | "UPTIME_MONITOR";
export interface StatusPage {
  id: string; workspaceId: string; slug: string; title: string;
  description: string | null; accentColor: string | null;
  theme: StatusPageTheme; publishedAt: number | null; createdBy: string | null;
  createdAt: number; updatedAt: number; deletedAt: number | null;
}
export interface StatusPageItem {
  id: string; statusPageId: string; workspaceId: string;
  resourceType: StatusPageResourceType;
  browserTestId: string | null; uptimeMonitorId: string | null;
  displayName: string; groupName: string | null; position: number; createdAt: number;
}
export interface IncidentUpdate {
  id: string; incidentId: string; workspaceId: string;
  message: string; createdBy: string | null; createdAt: number;
}
```

```ts
// domain/status_pages/repo.ts
export interface StatusPageUpdateFields {
  title?: string; description?: string | null; slug?: string;
  accentColor?: string | null; theme?: StatusPageTheme;
}
export interface StatusPageRepo {
  insert(page: StatusPage): Promise<void>;
  findById(workspaceId: string, id: string): Promise<StatusPage | null>;
  findBySlug(slug: string): Promise<StatusPage | null>;
  list(workspaceId: string): Promise<StatusPage[]>;
  update(id: string, changes: StatusPageUpdateFields, at: number): Promise<void>;
  setPublished(id: string, publishedAt: number | null, at: number): Promise<void>;
  softDelete(id: string, at: number): Promise<void>;
}
export interface StatusPageItemRepo {
  insert(item: StatusPageItem): Promise<void>;
  listForPage(statusPageId: string): Promise<StatusPageItem[]>; // position ASC
  findById(statusPageId: string, id: string): Promise<StatusPageItem | null>;
  update(id: string, changes: { displayName?: string; groupName?: string | null }): Promise<void>;
  remove(id: string): Promise<void>;
  reorder(statusPageId: string, orderedIds: string[]): Promise<void>;
  removeForResource(resource: { browserTestId?: string; uptimeMonitorId?: string }): Promise<void>;
}
export interface IncidentUpdateRepo {
  insert(update: IncidentUpdate): Promise<void>;
  listForIncident(incidentId: string): Promise<IncidentUpdate[]>; // createdAt DESC
  listForIncidents(workspaceId: string, incidentIds: string[]): Promise<Map<string, IncidentUpdate[]>>;
  findById(workspaceId: string, id: string): Promise<IncidentUpdate | null>;
  remove(id: string): Promise<void>;
}
```

- [ ] **Step 1: Write the migration**

`apps/api/migrations/0049_status_pages.sql` (cap triggers mirror `0027_atomic_limits.sql`; `throwIfCollectionCap` already maps `ZENGUY_COLLECTION_CAP_*` errors):

```sql
CREATE TABLE status_pages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  accent_color TEXT,
  theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('LIGHT','DARK','SYSTEM')),
  published_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX idx_status_pages_slug ON status_pages(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_status_pages_ws ON status_pages(workspace_id);

CREATE TABLE status_page_items (
  id TEXT PRIMARY KEY,
  status_page_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('BROWSER_TEST','UPTIME_MONITOR')),
  browser_test_id TEXT,
  uptime_monitor_id TEXT,
  display_name TEXT NOT NULL,
  group_name TEXT,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (
    (resource_type = 'BROWSER_TEST' AND browser_test_id IS NOT NULL AND uptime_monitor_id IS NULL)
    OR (resource_type = 'UPTIME_MONITOR' AND uptime_monitor_id IS NOT NULL AND browser_test_id IS NULL)
  )
);
CREATE UNIQUE INDEX idx_spi_page_test ON status_page_items(status_page_id, browser_test_id)
  WHERE browser_test_id IS NOT NULL;
CREATE UNIQUE INDEX idx_spi_page_monitor ON status_page_items(status_page_id, uptime_monitor_id)
  WHERE uptime_monitor_id IS NOT NULL;
CREATE INDEX idx_spi_page ON status_page_items(status_page_id, position);
CREATE INDEX idx_spi_test ON status_page_items(browser_test_id) WHERE browser_test_id IS NOT NULL;
CREATE INDEX idx_spi_monitor ON status_page_items(uptime_monitor_id) WHERE uptime_monitor_id IS NOT NULL;

CREATE TABLE incident_updates (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_incident_updates_incident ON incident_updates(incident_id, created_at DESC);
CREATE INDEX idx_incident_updates_ws ON incident_updates(workspace_id);

CREATE TRIGGER enforce_status_page_cap
BEFORE INSERT ON status_pages
WHEN NEW.deleted_at IS NULL AND (
  SELECT COUNT(*) FROM status_pages
  WHERE workspace_id = NEW.workspace_id AND deleted_at IS NULL
) >= 5
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_COLLECTION_CAP_STATUS_PAGES');
END;

CREATE TRIGGER enforce_status_page_item_cap
BEFORE INSERT ON status_page_items
WHEN (
  SELECT COUNT(*) FROM status_page_items
  WHERE status_page_id = NEW.status_page_id
) >= 50
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_COLLECTION_CAP_STATUS_PAGE_ITEMS');
END;
```

- [ ] **Step 2: Shared additions**

In `apps/api/src/shared/ids.ts`, add to `ID_PREFIXES`:

```ts
  statusPage: "sp",
  statusPageItem: "spi",
  incidentUpdate: "iu",
```

In `apps/api/src/shared/constants.ts` add (near the other collection constants):

```ts
export const MAX_STATUS_PAGES_PER_WORKSPACE = 5;
export const MAX_STATUS_PAGE_ITEMS = 50;
export const MAX_INCIDENT_UPDATE_LENGTH = 2000;
export const STATUS_PAGE_HISTORY_DAYS = 90;
export const STATUS_PAGE_RECENT_INCIDENT_DAYS = 15;
```

and inside `RATE_LIMITS` (next to `public_api`):

```ts
  status_page: { limit: 120, windowSeconds: 60 },
```

In `apps/api/src/domain/workspaces/permissions.ts` add `"status_pages.manage"` to the `Action` union and to all three role maps: OWNER `true`, ADMIN `true`, MEMBER `false` (same values as `secrets.manage`).

- [ ] **Step 3: Write domain types + repo interfaces** exactly as in the Interfaces block above (two new files under `src/domain/status_pages/`).

- [ ] **Step 4: Write the failing itest**

`apps/api/src/infrastructure/db/status_page_repos.itest.ts` — mirror the harness of `apps/api/src/infrastructure/db/incident_repos.itest.ts` (imports of `freshDb` from `../../test/helpers`, `describe/it` globals). Cover:

```ts
import { D1IncidentUpdateRepo } from "./incident_update_repo";
import { D1StatusPageItemRepo, D1StatusPageRepo } from "./status_page_repo";
import { freshDb } from "../../test/helpers";
import type { StatusPage, StatusPageItem } from "../../domain/status_pages/types";

const NOW = 1_756_400_000_000;

function page(id: string, slug: string, overrides: Partial<StatusPage> = {}): StatusPage {
  return {
    id, workspaceId: "ws_1", slug, title: "Acme Status", description: null,
    accentColor: null, theme: "SYSTEM", publishedAt: null, createdBy: "usr_1",
    createdAt: NOW, updatedAt: NOW, deletedAt: null, ...overrides,
  };
}
function item(id: string, pageId: string, position: number, overrides: Partial<StatusPageItem> = {}): StatusPageItem {
  return {
    id, statusPageId: pageId, workspaceId: "ws_1", resourceType: "UPTIME_MONITOR",
    browserTestId: null, uptimeMonitorId: `mon_${id}`, displayName: "API",
    groupName: null, position, createdAt: NOW, ...overrides,
  };
}

describe("D1StatusPageRepo", () => {
  it("inserts, finds by id and slug, lists per workspace, updates and publishes", async () => { /* insert 2 pages in ws_1 + 1 in ws_2; findById scoped by workspace returns null cross-tenant; findBySlug finds; update({title, slug, accentColor}) persists + bumps updated_at; setPublished(now) then (null) round-trips */ });
  it("enforces the global slug uniqueness and frees the slug on soft delete", async () => { /* second insert with same slug rejects (expect insert to throw /UNIQUE/); softDelete first page; same slug inserts fine; findBySlug ignores deleted */ });
  it("caps pages per workspace at 5", async () => { /* insert 5, 6th throws /ZENGUY_COLLECTION_CAP_STATUS_PAGES/ */ });
});

describe("D1StatusPageItemRepo", () => {
  it("inserts, lists ordered by position, updates names, removes and reorders", async () => { /* 3 items positions 0..2; reorder([c,a,b]) → listForPage returns positions 0..2 in new order */ });
  it("rejects the same resource twice on one page and caps items at 50", async () => { /* duplicate uptime_monitor_id on same page throws /UNIQUE/; loop 50 inserts, 51st throws /ZENGUY_COLLECTION_CAP_STATUS_PAGE_ITEMS/ */ });
  it("removes items for a deleted resource across pages", async () => { /* same monitor on 2 pages; removeForResource({uptimeMonitorId}) deletes both */ });
});

describe("D1IncidentUpdateRepo", () => {
  it("inserts, lists newest-first per incident and batch per workspace, finds scoped, removes", async () => { /* 2 updates on inc_1 (createdAt NOW, NOW+1000) → listForIncident returns newest first; listForIncidents(ws, [inc_1, inc_2]) maps both; findById with wrong workspace returns null; remove deletes */ });
});
```

Write the bodies out fully (the comments above describe the assertions; each `/* … */` must become real code — build rows with the helpers, call the repo, `expect(...)` on results).

- [ ] **Step 5: Run to verify failure**

Run: `pnpm --filter @zenguy/api test:integration src/infrastructure/db/status_page_repos.itest.ts`
Expected: FAIL — modules `./status_page_repo` / `./incident_update_repo` do not exist.

- [ ] **Step 6: Implement the D1 repos**

`apps/api/src/infrastructure/db/status_page_repo.ts` — mirror `monitor_repo.ts` (snake_case row interface, `toStatusPage(row)` mapper, `all/one/run/batch` helpers). Key implementations:

```ts
// update(): build SET clause only from provided fields, always `updated_at = ?`.
// reorder(): batch(db, orderedIds.map((id, index) =>
//   db.prepare("UPDATE status_page_items SET position = ? WHERE id = ? AND status_page_id = ?")
//     .bind(index, id, statusPageId)));
// removeForResource(): DELETE FROM status_page_items WHERE browser_test_id = ? (or uptime_monitor_id = ?)
// findBySlug(): WHERE slug = ? AND deleted_at IS NULL
// findById(): WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
// list(): WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY created_at ASC
```

`incident_update_repo.ts` mirrors the same style; `listForIncidents` uses a single `IN (…)` query with `workspace_id = ?` guard and groups rows into the Map.

- [ ] **Step 7: Run to verify pass**

Run: `pnpm --filter @zenguy/api test:integration src/infrastructure/db/status_page_repos.itest.ts`
Expected: PASS.

- [ ] **Step 8: Write the in-memory fakes**

`apps/api/src/test/fakes/status_page_repos.ts` (NEW file — do not touch `fakes/repos.ts`, it is dirty from the other session). Mirror `test/fakes/uptime_repos.ts` style: `FakeStatusPageRepo`, `FakeStatusPageItemRepo`, `FakeIncidentUpdateRepo` backed by `Map`s, implementing the three interfaces exactly, including slug-uniqueness (`throw new Error("UNIQUE constraint failed: status_pages.slug")` on duplicate live slug) and the 5/50 caps (`throw new Error("ZENGUY_COLLECTION_CAP_STATUS_PAGES")` / `…_STATUS_PAGE_ITEMS`) so use-case tests can assert mapping.

- [ ] **Step 9: Typecheck + full unit suite**

Run: `pnpm --filter @zenguy/api typecheck && pnpm --filter @zenguy/api test`
Expected: PASS (permissions change may break an exhaustiveness test — if `rbac`/permissions tests fail, update their expected tables to include `status_pages.manage`).

- [ ] **Step 10: Commit**

```bash
git add apps/api/migrations/0049_status_pages.sql apps/api/src/domain/status_pages apps/api/src/infrastructure/db/status_page_repo.ts apps/api/src/infrastructure/db/incident_update_repo.ts apps/api/src/infrastructure/db/status_page_repos.itest.ts apps/api/src/test/fakes/status_page_repos.ts apps/api/src/shared/ids.ts apps/api/src/shared/constants.ts apps/api/src/domain/workspaces/permissions.ts
git commit -m "api: status pages — migracion, dominio y repos D1"
```

---

### Task 2: Input rules + page CRUD use cases

**Files:**
- Create: `apps/api/src/domain/status_pages/rules.ts`
- Create: `apps/api/src/application/status_pages/{create,update,publish,delete,list,get}_status_page.ts` (6 files; `get` has no own test — covered via routes)
- Create: `apps/api/src/application/status_pages/types.ts`
- Test: `apps/api/src/application/status_pages/create_status_page.test.ts`, `update_status_page.test.ts`, `publish_status_page.test.ts`, `delete_status_page.test.ts`

**Interfaces:**
- Consumes: Task 1 repos/fakes, `can(role, "status_pages.manage")`, `ensureActiveSubscription`, `WriteAudit`, `IdGenerator` (`newId("sp")`), `Clock`, `throwIfCollectionCap`, `conflict/forbidden/notFound/validation` from `shared/errors`.
- Produces: `StatusPageOutput` (page + `itemCount`), classes `CreateStatusPage`, `UpdateStatusPage`, `PublishStatusPage` (method `execute({ …, publish: boolean })`), `DeleteStatusPage`, `ListStatusPages`, `GetStatusPage` (returns `{ page, items }`). `parseStatusPageConfig`, `parseStatusPageUpdate`, `throwIfSlugTaken`, `RESERVED_STATUS_PAGE_SLUGS`, `statusPageSlugSchema` from `rules.ts`.

- [ ] **Step 1: Write failing tests** (audit-actions note: use `AUDIT_ACTIONS.statusPageCreated` etc. — added in this task's Step 3 so tests compile). `create_status_page.test.ts`:

```ts
import { CreateStatusPage } from "./create_status_page";
import { FakeStatusPageRepo } from "../../test/fakes/status_page_repos";
// FakeSubscriptionRepo, FakeAuditWriter, FixedClock, FakeIds: mirror the imports used in
// application/uptime/create_monitor-adjacent tests (see list_monitors.test.ts and
// application/secrets tests for the audit/subscription fakes in use).

describe("CreateStatusPage", () => {
  it("creates a draft page with a valid slug and writes an audit entry", async () => {});
  it("rejects MEMBER role with FORBIDDEN", async () => {});
  it("rejects reserved slugs with VALIDATION_ERROR", async () => {}); // slug: "preview"
  it("rejects malformed slugs", async () => {});                      // "Ab", "-x-", "a".repeat(64)
  it("maps a duplicate slug to CONFLICT", async () => {});
  it("maps the page cap trigger to RATE_LIMITED", async () => {});
});
```

`update_status_page.test.ts`: updates title/description/accent/theme/slug; rejects invalid accent (`"red"`, `"#12345"`); NOT_FOUND cross-workspace; slug conflict → CONFLICT; audit `statusPageUpdated`.
`publish_status_page.test.ts`: publish sets `publishedAt` (idempotent — publishing twice keeps first timestamp), unpublish nulls it; MEMBER forbidden; audits `statusPagePublished`/`statusPageUnpublished`.
`delete_status_page.test.ts`: soft-deletes, audits `statusPageDeleted`, NOT_FOUND for other workspace.
Fill every body with real arrange/act/assert code using the fakes.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @zenguy/api test src/application/status_pages`
Expected: FAIL — modules not found.

- [ ] **Step 3: Add the audit actions** (needed by these use cases; the activity bridge comes in Task 4 — TypeScript will force it, so do both halves here if the build demands it, and keep Task 4 for the update-specific actions). In `domain/audit/actions.ts` add:

```ts
  statusPageCreated: "status_page.created",
  statusPageUpdated: "status_page.updated",
  statusPagePublished: "status_page.published",
  statusPageUnpublished: "status_page.unpublished",
  statusPageDeleted: "status_page.deleted",
  statusPageItemsChanged: "status_page.items_changed",
  incidentUpdatePosted: "incident.update_posted",
  incidentUpdateDeleted: "incident.update_deleted",
```

`AUDIT_TO_ACTIVITY` in `domain/activity/catalog.ts` is `Record<AuditAction, …>` and will now fail to compile: add matching `ACTIVITY_EVENTS` keys (`statusPageCreated: "status_page.created"`, … same 8 strings), one `ACTIVITY_EVENT_SPECS` entry per new event copying the exact spec shape of the `secretCreated` entry (volume `normal`), and the 8 `AUDIT_TO_ACTIVITY` mappings. If `catalog.ts` has a test asserting counts, update it.

- [ ] **Step 4: Implement `rules.ts`**

```ts
import { z } from "zod";
import { conflict, validation } from "../../shared/errors";

export const RESERVED_STATUS_PAGE_SLUGS = new Set([
  "json", "preview", "assets", "api", "app", "admin", "www", "status", "zenguy", "docs", "help", "staging",
]);
export const statusPageSlugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/u, "Lowercase letters, digits and hyphens (3-63 chars)")
  .min(3).max(63)
  .refine((slug) => !RESERVED_STATUS_PAGE_SLUGS.has(slug), { message: "This slug is reserved" });

const accentSchema = z.string().regex(/^#[0-9a-f]{6}$/u, "Hex color like #22c55e");
const themeSchema = z.enum(["LIGHT", "DARK", "SYSTEM"]);

export const statusPageConfigSchema = z.object({
  title: z.string().trim().min(1).max(120),
  slug: statusPageSlugSchema,
  description: z.string().trim().max(500).nullish(),
  accentColor: accentSchema.nullish(),
  theme: themeSchema.default("SYSTEM"),
});
export const statusPageUpdateSchema = statusPageConfigSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required" },
);
export const statusPageItemConfigSchema = z.object({
  resourceType: z.enum(["BROWSER_TEST", "UPTIME_MONITOR"]),
  resourceId: z.string().min(1).max(80),
  displayName: z.string().trim().min(1).max(80),
  groupName: z.string().trim().min(1).max(60).nullish(),
});
export const statusPageItemUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  groupName: z.string().trim().min(1).max(60).nullish(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export function throwIfSlugTaken(error: unknown): void {
  if (
    error instanceof Error &&
    /UNIQUE/i.test(error.message) &&
    /status_pages/i.test(error.message)
  ) {
    throw conflict("Slug already in use");
  }
}
```

Parse helpers follow the `parseMonitorConfig` convention in `application/uptime/input.ts` (zod `safeParse` → `validation(details)`); export `parseStatusPageConfig` / `parseStatusPageUpdate` / `parseStatusPageItemConfig` / `parseStatusPageItemUpdate` from `rules.ts` or a sibling `application/status_pages/input.ts` — match how uptime splits domain `rules.ts` vs application `input.ts` and keep the same split.

- [ ] **Step 5: Implement the use cases** — each mirrors `CreateMonitor`/`DeleteMonitor` structure exactly (role check → `ensureActiveSubscription` (writes only) → work → audit). `CreateStatusPage.execute` core:

```ts
if (!can(input.actorRole, "status_pages.manage")) throw forbidden();
await ensureActiveSubscription(this.subscriptions, input.workspaceId, this.clock.now());
const config = parseStatusPageConfig(input.config);
const now = this.clock.now();
const page: StatusPage = {
  id: this.ids.newId("sp"), workspaceId: input.workspaceId,
  slug: config.slug, title: config.title,
  description: config.description ?? null, accentColor: config.accentColor ?? null,
  theme: config.theme, publishedAt: null, createdBy: input.actor.id,
  createdAt: now, updatedAt: now, deletedAt: null,
};
try {
  await this.pages.insert(page);
} catch (error) {
  throwIfSlugTaken(error);
  throwIfCollectionCap(error);
  throw error;
}
await this.audit.execute({
  workspaceId: input.workspaceId, actorUserId: input.actor.id,
  action: AUDIT_ACTIONS.statusPageCreated, resourceType: "status_page",
  resourceId: page.id, metadata: { title: page.title, slug: page.slug }, ip: input.ip,
});
return page;
```

`UpdateStatusPage`: load `findById` (NOT_FOUND otherwise), parse update, `pages.update(id, changes, now)` with the same try/catch for slug, audit `statusPageUpdated` with `metadata: { changed: Object.keys(changes) }`. `PublishStatusPage.execute({ publish })`: load, `setPublished(publish ? (page.publishedAt ?? now) : null, now)`, audit the corresponding action with `metadata: { slug: page.slug }`. `DeleteStatusPage`: load, `softDelete`, audit. `ListStatusPages`: `pages.list(workspaceId)` + `items.listForPage` per page only to compute `itemCount` — instead add nothing to repos: return pages and let the route presenter omit counts… **Decision: no itemCount in v1 list output; `StatusPageOutput = StatusPage`.** `GetStatusPage`: `{ page, items: await items.listForPage(page.id) }`, any member (no role check — mirrors `GetMonitor`).

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @zenguy/api test src/application/status_pages`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/application/status_pages apps/api/src/domain/status_pages/rules.ts apps/api/src/domain/audit/actions.ts apps/api/src/domain/activity/catalog.ts
git commit -m "api: status pages — use cases CRUD de paginas"
```

(If `catalog.ts` tests were updated, include them.)

---

### Task 3: Item use cases + resource-deletion hooks

**Files:**
- Create: `apps/api/src/application/status_pages/add_item.ts`, `update_item.ts`, `remove_item.ts`, `reorder_items.ts`
- Modify: `apps/api/src/domain/status_pages/rules.ts` (+`throwIfDuplicateItem`)
- Modify: `apps/api/src/application/uptime/delete_monitor.ts`, `apps/api/src/application/browser_tests/delete_browser_test.ts` (+ their existing tests)
- Test: `apps/api/src/application/status_pages/add_item.test.ts`, `reorder_items.test.ts` (update/remove covered inside these files)

**Interfaces:**
- Consumes: `StatusPageItemRepo`, `StatusPageRepo`, `MonitorRepo.findById`, `BrowserTestRepo.findById`, fakes (`FakeMonitorRepo`, browser-test fake — find it in `test/fakes/`, it is imported by `application/browser_tests/list_browser_tests.test.ts`).
- Produces: `AddStatusPageItem`, `UpdateStatusPageItem`, `RemoveStatusPageItem`, `ReorderStatusPageItems` classes. All audit as `AUDIT_ACTIONS.statusPageItemsChanged` with `metadata: { op: "added" | "renamed" | "removed" | "reordered", itemId, resourceType?, resourceId? }`.

- [ ] **Step 1: Write failing tests.** `add_item.test.ts` cases: adds a monitor item (validates monitor exists in this workspace via `FakeMonitorRepo`, position = current max + 1); adds a browser-test item; NOT_FOUND when the resource belongs to another workspace or is soft-deleted; CONFLICT when the same resource is already on the page (fake throws UNIQUE — map via a `throwIfDuplicateItem` helper in `rules.ts`: same shape as `throwIfSlugTaken` but matching `/status_page_items/i`, message "Resource already on this page"); RATE_LIMITED on the 50-item cap; MEMBER forbidden; `UpdateStatusPageItem` renames displayName/groupName; `RemoveStatusPageItem` deletes; both NOT_FOUND when item id belongs to a different page. `reorder_items.test.ts`: happy path persists new positions; VALIDATION_ERROR when `itemIds` is not exactly the full current set (missing, extra, or duplicate ids).

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @zenguy/api test src/application/status_pages` → FAIL (modules missing).

- [ ] **Step 3: Implement.** `AddStatusPageItem.execute({ workspaceId, actor, actorRole, pageId, config, ip })`: role check → active subscription → `pages.findById` (NOT_FOUND) → parse → resolve resource:

```ts
let browserTestId: string | null = null;
let uptimeMonitorId: string | null = null;
if (config.resourceType === "UPTIME_MONITOR") {
  const monitor = await this.monitors.findById(input.workspaceId, config.resourceId);
  if (monitor === null || monitor.deletedAt !== null) throw notFound("Uptime monitor");
  uptimeMonitorId = monitor.id;
} else {
  const test = await this.tests.findById(input.workspaceId, config.resourceId);
  if (test === null || test.deletedAt !== null) throw notFound("Browser test");
  browserTestId = test.id;
}
const existing = await this.items.listForPage(page.id);
const position = existing.length === 0 ? 0 : Math.max(...existing.map((entry) => entry.position)) + 1;
```

then insert with `newId("spi")` inside try/catch (`throwIfDuplicateItem`, `throwIfCollectionCap`), audit. (Confirm `BrowserTestRepo.findById(workspaceId, id)` exists in `domain/browser_tests/repo.ts` — it does for the routes; adjust the call to its exact signature.) `ReorderStatusPageItems`: load items, compare sets:

```ts
const current = new Set(items.map((item) => item.id));
const provided = new Set(input.itemIds);
if (provided.size !== input.itemIds.length || current.size !== provided.size ||
    [...current].some((id) => !provided.has(id))) {
  throw validation([{ field: "itemIds", message: "itemIds must contain every item exactly once" }]);
}
await this.items.reorder(page.id, input.itemIds);
```

- [ ] **Step 4: Hook resource deletion.** In `DeleteMonitor` add constructor dep `private readonly statusPageItems: Pick<StatusPageItemRepo, "removeForResource">` and after `softDelete`: `await this.statusPageItems.removeForResource({ uptimeMonitorId: monitor.id });`. Same in `DeleteBrowserTest` with `{ browserTestId: test.id }` (open the file first; place the call right after its soft-delete, mirroring the incident-close block placement). Update both use cases' existing unit tests to pass a `FakeStatusPageItemRepo` and assert the items are gone. Wiring in routes/app.ts happens in Task 8 — the constructors change now, so `uptime.ts`/`browser_tests.ts` route files need the new argument (`dependencies.statusPageItems`) added to their `…RoutesDependencies` and constructor calls; add it now so typecheck stays green, and thread the dependency from `app.ts` **only as an edit, without committing app.ts yet** (see Global Constraints).

- [ ] **Step 5: Run** — `pnpm --filter @zenguy/api test src/application/status_pages src/application/uptime src/application/browser_tests && pnpm --filter @zenguy/api typecheck` → PASS.

- [ ] **Step 6: Commit** (everything except `app.ts` if still shared-dirty):

```bash
git add apps/api/src/application/status_pages apps/api/src/application/uptime/delete_monitor.ts apps/api/src/application/uptime/delete_monitor.test.ts apps/api/src/application/browser_tests/delete_browser_test.ts apps/api/src/application/browser_tests/delete_browser_test.test.ts apps/api/src/domain/status_pages/rules.ts apps/api/src/http/routes/uptime.ts apps/api/src/http/routes/browser_tests.ts
git commit -m "api: status pages — items y limpieza al borrar recursos"
```

(If `delete_monitor.test.ts` / `delete_browser_test.test.ts` do not exist yet, create them for the new behavior only.)

---

### Task 4: Incident update use cases

**Files:**
- Create: `apps/api/src/application/incidents/post_incident_update.ts`, `delete_incident_update.ts`
- Test: `apps/api/src/application/incidents/post_incident_update.test.ts`, `delete_incident_update.test.ts`

**Interfaces:**
- Consumes: `IncidentRepo.findById(workspaceId, id)`, `IncidentUpdateRepo`, `MAX_INCIDENT_UPDATE_LENGTH`, audit actions `incidentUpdatePosted` / `incidentUpdateDeleted` (already added in Task 2).
- Produces: `PostIncidentUpdate` (`execute({ workspaceId, actor, actorRole, incidentId, message, ip }) → IncidentUpdate`), `DeleteIncidentUpdate` (`execute({ workspaceId, actor, actorRole, incidentId, updateId, ip })`). Listing needs no use case — routes call `incidentUpdates.listForIncident` after loading the incident.

- [ ] **Step 1: Failing tests.** `PostIncidentUpdate`: creates with trimmed message, `newId("iu")`, audits `incidentUpdatePosted` with `resourceType: "incident"`; FORBIDDEN for MEMBER (permission `status_pages.manage`); NOT_FOUND when incident is in another workspace; VALIDATION_ERROR on empty or > 2000-char message. `DeleteIncidentUpdate`: removes, audits; NOT_FOUND for foreign update id or when `update.incidentId !== incidentId`.
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @zenguy/api test src/application/incidents` → FAIL.
- [ ] **Step 3: Implement.** Message validation inline (no zod needed):

```ts
const message = input.message.trim();
if (message.length === 0 || message.length > MAX_INCIDENT_UPDATE_LENGTH) {
  throw validation([{ field: "message", message: `1-${MAX_INCIDENT_UPDATE_LENGTH} characters` }]);
}
```

Posting is allowed on OPEN and RESOLVED incidents (a post-mortem note is legitimate).
- [ ] **Step 4: Run to verify pass** — same command → PASS.
- [ ] **Step 5: Commit** — `git add apps/api/src/application/incidents && git commit -m "api: status pages — updates publicos de incidentes"`.

---

### Task 5: Availability math (pure)

**Files:**
- Create: `apps/api/src/application/status_pages/availability.ts`
- Test: `apps/api/src/application/status_pages/availability.test.ts`

**Interfaces (produced, used verbatim by Task 6):**

```ts
export interface IncidentInterval { openedAt: number; resolvedAt: number | null }
export interface DayAvailability { date: string; downtimeSeconds: number; hasData: boolean }
export const DAY_MS = 86_400_000;
export function dailyDowntime(
  incidents: IncidentInterval[], nowMs: number, days: number, resourceCreatedAt: number,
): DayAvailability[];               // length === days, oldest first, UTC days, date "YYYY-MM-DD"
export function uptimePercent(
  incidents: IncidentInterval[], nowMs: number, days: number, resourceCreatedAt: number,
): number | null;                   // null when the window start >= now; 2 decimals
```

- [ ] **Step 1: Failing tests** — cover: no incidents → 90 zeroed days ending today (UTC), `hasData` false before `resourceCreatedAt`'s day; a resolved incident inside one day adds its exact seconds to that day only; an incident spanning midnight splits across both days; an open incident accrues up to `nowMs` and continues into today; per-day downtime clamps at 86 400; `uptimePercent` for a 90-day-old resource with a single 1 h outage → `99.95`; a resource created 12 h ago with 6 h down → `50`; brand-new resource (createdAt === now) → `null`; incidents entirely before the window are ignored.
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @zenguy/api test src/application/status_pages/availability.test.ts` → FAIL.
- [ ] **Step 3: Implement** with plain arithmetic (no Date libraries): day boundaries via `Math.floor(nowMs / DAY_MS) * DAY_MS`; iterate days, sum `overlap = min(end, dayEnd) - max(openedAt, dayStart, windowStart)` per incident (treat `resolvedAt ?? nowMs` as end); `date` via `new Date(dayStart).toISOString().slice(0, 10)`; window start = `max(nowMs - days * DAY_MS, resourceCreatedAt)`; percent = `Math.round((1 - downtime / (nowMs - windowStart)) * 10_000) / 100`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git add apps/api/src/application/status_pages/availability.ts apps/api/src/application/status_pages/availability.test.ts && git commit -m "api: status pages — calculo de disponibilidad por incidentes"`.

---

### Task 6: Public read model + new repo methods

**Files:**
- Modify: `apps/api/src/domain/incidents/repo.ts` (+`listForPublicWindow`), `apps/api/src/infrastructure/db/incident_repo.ts`, `apps/api/src/test/fakes/incident_repos.ts`
- Modify: `apps/api/src/domain/uptime/repo.ts` (+`findByIds`), `apps/api/src/infrastructure/db/monitor_repo.ts`, `apps/api/src/test/fakes/uptime_repos.ts`
- Modify: `apps/api/src/domain/browser_tests/repo.ts` (+`findByIds` on `BrowserTestRepo`, +`testsWithFinishedRuns` on `RunRepo`), `apps/api/src/infrastructure/db/browser_test_repo.ts`, `apps/api/src/infrastructure/db/run_repo.ts`, corresponding fakes
- Create: `apps/api/src/application/status_pages/get_public_status_page.ts`, extend `apps/api/src/application/status_pages/types.ts`
- Test: `apps/api/src/application/status_pages/get_public_status_page.test.ts`; extend `apps/api/src/infrastructure/db/status_page_repos.itest.ts` with one `describe` covering the four new D1 methods

**Interfaces:**
- Produces repo methods:

```ts
// IncidentRepo — OPEN at any age, or opened within the window; newest first
listForPublicWindow(workspaceId: string, sinceMs: number): Promise<Incident[]>;
// MonitorRepo / BrowserTestRepo — live rows only, scoped to workspace
findByIds(workspaceId: string, ids: string[]): Promise<UptimeMonitor[]>;   // / BrowserTest[]
// RunRepo — ids of tests having >= 1 run with finished_at NOT NULL
testsWithFinishedRuns(workspaceId: string, testIds: string[]): Promise<Set<string>>;
```

- Produces the view types in `application/status_pages/types.ts`:

```ts
export type PublicItemState = "OPERATIONAL" | "DOWN" | "PENDING";
export type OverallStatus = "OPERATIONAL" | "PARTIAL_OUTAGE" | "MAJOR_OUTAGE";
export interface PublicStatusItem {
  id: string; displayName: string; groupName: string | null;
  state: PublicItemState; uptimePercent: number | null; days: DayAvailability[];
}
export interface PublicIncidentView {
  displayName: string; status: "ONGOING" | "RESOLVED";
  startedAt: number; resolvedAt: number | null; durationSeconds: number;
  updates: { message: string; createdAt: number }[];   // newest first
}
export interface PublicStatusPageView {
  slug: string; title: string; description: string | null;
  accentColor: string | null; theme: StatusPageTheme;
  overall: OverallStatus; items: PublicStatusItem[];
  incidents: PublicIncidentView[];                     // ongoing first, then by startedAt desc
  generatedAt: number;
}
```

- Produces `GetPublicStatusPage` with two methods: `bySlug(slug: string): Promise<PublicStatusPageView | null>` (null unless published) and `byId(workspaceId: string, pageId: string): Promise<PublicStatusPageView | null>` (drafts allowed — used by the preview route).

- [ ] **Step 1: Failing unit test** for `GetPublicStatusPage` using fakes: page with 1 monitor item + 1 test item; open incident on the monitor → item DOWN, overall PARTIAL_OUTAGE, incident listed ONGOING with its updates newest-first; resolving it and moving `openedAt` 20 days back → excluded from `incidents` (15-day window) but still counted in the bars; test item with no finished run → PENDING and excluded from overall; deleted/foreign resources filtered out of items; unpublished page → `bySlug` null but `byId` returns the view; all DOWN → MAJOR_OUTAGE; sanitization: `JSON.stringify(view)` contains neither the monitor URL nor the internal resource ids nor the internal names.
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @zenguy/api test src/application/status_pages/get_public_status_page.test.ts` → FAIL.
- [ ] **Step 3: Add the four repo methods** (D1 + fakes). D1 SQL:

```sql
-- listForPublicWindow
SELECT * FROM incidents
WHERE workspace_id = ?1 AND (status = 'OPEN' OR opened_at >= ?2)
ORDER BY opened_at DESC
-- findByIds (uptime; browser_tests analogous)
SELECT * FROM uptime_monitors WHERE workspace_id = ?1 AND deleted_at IS NULL AND id IN (…)
-- testsWithFinishedRuns
SELECT DISTINCT browser_test_id FROM test_runs
WHERE workspace_id = ?1 AND finished_at IS NOT NULL AND browser_test_id IN (…)
```

Build the `IN` lists with the codebase's existing placeholder-join helper if one exists (search for `map(() => "?")` in `infrastructure/db`); return early with empty results for empty id arrays. Extend the Task 1 itest file with real-data assertions for all four.
- [ ] **Step 4: Implement `GetPublicStatusPage`.** Composition (shared private `build(page)`):

```ts
const items = await this.items.listForPage(page.id);
const monitorIds = items.flatMap((i) => (i.uptimeMonitorId ? [i.uptimeMonitorId] : []));
const testIds = items.flatMap((i) => (i.browserTestId ? [i.browserTestId] : []));
const [monitors, tests, incidents] = await Promise.all([
  this.monitors.findByIds(page.workspaceId, monitorIds),
  this.tests.findByIds(page.workspaceId, testIds),
  this.incidents.listForPublicWindow(page.workspaceId, now - STATUS_PAGE_HISTORY_DAYS * DAY_MS),
]);
const finishedTests = await this.runs.testsWithFinishedRuns(page.workspaceId, testIds);
```

Per item: resolve its resource (skip item if missing → deleted); incidents for the resource = filter by `uptimeMonitorId`/`browserTestId`; `state = openIncident ? "DOWN" : pending ? "PENDING" : "OPERATIONAL"` where pending = monitor `currentStatus === "UNKNOWN"` or test not in `finishedTests`; `days = dailyDowntime(resourceIncidents, now, STATUS_PAGE_HISTORY_DAYS, resource.createdAt)`; `uptimePercent = state === "PENDING" ? null : uptimePercent(…)`. Overall from non-pending items. Public incidents: incidents whose resource is on the page AND (`status === "OPEN"` OR `resolvedAt >= now - STATUS_PAGE_RECENT_INCIDENT_DAYS * DAY_MS`), mapped with the **item display name**, `durationSeconds = ((resolvedAt ?? now) - openedAt) / 1000` rounded, updates from `this.updates.listForIncidents(page.workspaceId, incidentIds)`.
- [ ] **Step 5: Run all** — `pnpm --filter @zenguy/api test src/application/status_pages && pnpm --filter @zenguy/api test:integration src/infrastructure/db/status_page_repos.itest.ts && pnpm --filter @zenguy/api typecheck` → PASS.
- [ ] **Step 6: Commit** —

```bash
git add apps/api/src/domain/incidents/repo.ts apps/api/src/domain/uptime/repo.ts apps/api/src/domain/browser_tests/repo.ts apps/api/src/infrastructure/db/incident_repo.ts apps/api/src/infrastructure/db/monitor_repo.ts apps/api/src/infrastructure/db/browser_test_repo.ts apps/api/src/infrastructure/db/run_repo.ts apps/api/src/test/fakes apps/api/src/application/status_pages apps/api/src/infrastructure/db/status_page_repos.itest.ts
git commit -m "api: status pages — read model publico"
```

---

### Task 7: HTML renderer

**Files:**
- Create: `apps/api/src/http/views/status_page_html.ts`
- Test: `apps/api/src/http/views/status_page_html.test.ts`

**Interfaces:**
- Produces: `renderStatusPage(view: PublicStatusPageView, options: { canonicalUrl: string; preview: boolean }): string` and `renderStatusPageNotFound(): string` (both return complete `<!doctype html>` documents).

- [ ] **Step 1: Failing tests** (string assertions on the returned HTML):
  - title/description present and **escaped**: a view with `title: '<script>alert(1)</script>'` must NOT contain `<script>` and must contain `&lt;script&gt;`;
  - overall banner text: `All systems operational` / `Partial outage` / `Major outage`;
  - one section label per distinct `groupName`, ungrouped items first;
  - a `.bar` element per day (90 per item) with `title` attributes containing human durations (`title="2026-08-12 — 1h 5m down"`, zero-days `No downtime`), class `down` when `downtimeSeconds >= 3600`, `partial` when `1..3599`, `nodata` when `hasData === false`;
  - uptime percent rendered as `99.95%` and `PENDING` items render `No data yet` instead of a percent;
  - incidents section: ONGOING incident shows `Ongoing`, resolved shows duration; updates listed with their text escaped;
  - `<meta http-equiv="refresh" content="60">` present when `preview: false`, ABSENT when `preview: true`;
  - `<link rel="canonical" href="…">` uses `options.canonicalUrl`;
  - head carries `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, and OG tags: `og:title` = page title, `og:description` = the overall banner text (e.g. `All systems operational`), `og:url` = canonical URL;
  - footer contains `Powered by Zenguy` linking to `https://zenguy.com?utm_source=status_page`;
  - `accentColor` appears only inside the `<style>` block and only when it matches `^#[0-9a-f]{6}$` (defense in depth: pass an invalid accent and assert it is dropped);
  - no occurrence of `undefined` or `null` in output.
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @zenguy/api test src/http/views/status_page_html.test.ts` → FAIL.
- [ ] **Step 3: Implement** with `import { html, raw } from "hono/html"` — interpolations are auto-escaped; only the validated accent and the composed inner fragments go through `raw`/nested `html` templates. Single inline `<style>` with CSS custom props; theme handling: `SYSTEM` uses `@media (prefers-color-scheme: dark)`, `DARK`/`LIGHT` hardcode palettes via a class on `<html>`. Layout: centered column (max-width 720 px), header (title, description, generated-at), banner, item cards (name, state pill, uptime %, 90 bars as flex `<span>`s), incidents list, badge footer. Format helpers (`formatDuration(seconds)`, `formatPercent`) local to the file. No `<script>` anywhere.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git add apps/api/src/http/views && git commit -m "api: status pages — render SSR con hono/html"`.

---### Task 8: Admin routes + presenter + preview + wiring

**Files:**
- Create: `apps/api/src/http/presenters/status_page.ts`, `apps/api/src/http/routes/status_pages.ts`, `apps/api/src/http/routes/incident_updates.ts`
- Modify: `apps/api/src/app.ts` [SHARED-DIRTY — edit, do not commit while foreign hunks remain]
- Test: `apps/api/src/http/routes/status_page_routes.itest.ts`, `apps/api/src/http/routes/incident_update_routes.itest.ts`; extend `rbac_matrix.itest.ts` and `cross_tenant.itest.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces routes (all under the existing `/api/workspaces` mount):
  - `GET  /:workspaceId/status-pages` → `{ data: StatusPagePresented[] }`
  - `POST /:workspaceId/status-pages` (ADMIN, active sub, `collectionCreateRateLimit`) → 201 `{ data }`
  - `GET  /:workspaceId/status-pages/:pageId` → `{ data: { …page, items: ItemPresented[] } }`
  - `PATCH/DELETE /:workspaceId/status-pages/:pageId`, `POST …/publish`, `POST …/unpublish`
  - `POST …/:pageId/items`, `PATCH/DELETE …/items/:itemId`, `PUT …/items/order` (`{ itemIds: string[] }`)
  - `GET  …/:pageId/preview` → `text/html` (any member; renders `byId` draft view with `preview: true`)
  - `GET  /:workspaceId/incidents/:incidentId/updates` → `{ data: IncidentUpdatePresented[] }`
  - `POST /:workspaceId/incidents/:incidentId/updates` (ADMIN) → 201; `DELETE …/updates/:updateId` (ADMIN) → `{ data: { ok: true } }`
- Presenter: `presentStatusPage(page)` → ISO dates (`publishedAt` nullable), camelCase passthrough otherwise; `presentStatusPageItem(item)` exposes `id, resourceType, resourceId (the browser_test_id/uptime_monitor_id — INTERNAL admin surface, fine here), displayName, groupName, position`; `presentIncidentUpdate(update)` → ISO `createdAt` plus `createdBy`.

- [ ] **Step 1: Coordination checkpoint.** Run `git status apps/api/src/app.ts apps/api/wrangler.jsonc`. If still dirty with the OAuth session's hunks, check `ListAgents` for a live peer session and ask it (SendMessage) to commit its `apps/api` work; proceed regardless (edits are compatible), but keep those files out of your commits.
- [ ] **Step 2: Failing itests.** Mirror `uptime_routes.itest.ts` harness exactly (fresh D1 via `freshDb`, `buildApp`, `issueAccessToken`, owner/admin/member fixtures, real D1 repos, `FixedClock`, `FakeIds`). `status_page_routes.itest.ts` cases: create→list→get round-trip as admin; member GETs succeed but POST/PATCH/DELETE/publish return 403; slug conflict across two different workspaces → 409; PATCH slug change frees old slug for reuse after DELETE; add monitor + test items (create the resources first through their repos), duplicate item → 409, PATCH rename, PUT order with full permutation → order persisted, PUT with missing id → 400; publish → `publishedAt` ISO string, unpublish → null; preview returns 200 `text/html` for member containing the page title and NOT containing `<meta http-equiv="refresh"`; preview of a page in another workspace → 404. `incident_update_routes.itest.ts`: seed an incident row directly (mirror how `incident_repos.itest.ts` builds one), admin posts update (201, trimmed), member post → 403, member list → 200, delete by admin → gone, cross-workspace post → 404.
- [ ] **Step 3: Run to verify failure** — `pnpm --filter @zenguy/api test:integration src/http/routes/status_page_routes.itest.ts src/http/routes/incident_update_routes.itest.ts` → FAIL (404s — routes not mounted).
- [ ] **Step 4: Implement route files** mirroring `uptime.ts` structure (deps interface, use-case construction at the top, `auth`/`requireVerifiedEmail`/`workspace`/`requireAction("status_pages.manage")`/`active` middleware chains, `zjson`/`zquery`, `requestIp`). Preview handler:

```ts
app.get(
  "/:workspaceId/status-pages/:pageId/preview",
  auth, requireVerifiedEmail, workspace,
  async (context) => {
    const view = await getPublicStatusPage.byId(
      context.get("workspace").id,
      context.req.param("pageId"),
    );
    if (view === null) throw notFound("Status page");
    const canonicalUrl = `${dependencies.config.appUrl}/status/${view.slug}`;
    return context.html(renderStatusPage(view, { canonicalUrl, preview: true }));
  },
);
```

(`config.appUrl` exists on `AppConfig` — same field the CORS setup uses.)
- [ ] **Step 5: Wire `app.ts`.** Construct `const statusPages = overrides.statusPages ?? new D1StatusPageRepo(env.DB);` (+ items, incidentUpdates) next to the other repo constructions; add the three fields to `AppOverrides`; mount `statusPageRoutes` and `incidentUpdateRoutes` on `"/api/workspaces"` next to `incidentRoutes`; pass `statusPageItems` into the existing `uptimeRoutes`/`browserTestRoutes` dependency objects (Task 3 added the parameter).
- [ ] **Step 6: rbac + cross-tenant.** Open `rbac_matrix.itest.ts` and add rows for the new endpoints following its table format (member: read yes / write no; admin+owner: all). Open `cross_tenant.itest.ts` and add the status-page + incident-update endpoints to its foreign-workspace sweep.
- [ ] **Step 7: Run** — the two new itest files, plus `rbac_matrix`, `cross_tenant`, and `pnpm --filter @zenguy/api typecheck` → PASS.
- [ ] **Step 8: Commit** (leave `app.ts` out if still shared-dirty; note it):

```bash
git add apps/api/src/http/presenters/status_page.ts apps/api/src/http/routes/status_pages.ts apps/api/src/http/routes/incident_updates.ts apps/api/src/http/routes/status_page_routes.itest.ts apps/api/src/http/routes/incident_update_routes.itest.ts apps/api/src/http/routes/rbac_matrix.itest.ts apps/api/src/http/routes/cross_tenant.itest.ts
git commit -m "api: status pages — rutas de gestion y preview"
```

---

### Task 9: Public routes (SSR + JSON, cache, rate limit)

**Files:**
- Create: `apps/api/src/http/routes/status_public.ts`
- Modify: `apps/api/src/app.ts` [SHARED-DIRTY]
- Test: `apps/api/src/http/routes/status_public_routes.itest.ts`

**Interfaces:**
- Produces: `statusPublicRoutes(deps)` mounted at `app.route("/status", …)` with `GET /:slug` (HTML) and `GET /:slug/json`. Deps: `{ getPublicStatusPage, rateLimiter, clock, config: Pick<AppConfig, "appUrl">, cache?: Pick<Cache, "match" | "put"> }`. `AppOverrides` gains `statusCache?`.

- [ ] **Step 1: Failing itest.** Seed via repos: workspace + monitor + published page + item + one resolved incident + one update. Cases:
  - `GET /status/<slug>` → 200, `content-type: text/html`, `cache-control: public, max-age=60`, CSP header `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, body contains display name, update text, `Powered by Zenguy`, meta refresh;
  - **sanitization sweep**: body does NOT contain the monitor URL, the monitor's internal name, the monitor id, the incident id, or the string `NOTIFICATION`;
  - no `set-cookie` header on any public response;
  - unknown slug, draft slug, and soft-deleted slug all → 404 with the identical generic HTML body;
  - `GET /status/<slug>/json` → 200 JSON `{ data: PublicStatusPageView }`, `access-control-allow-origin: *`, same sanitization sweep on the raw body;
  - cache: pass a fake cache (`Map`-backed `{ match, put }`) via `overrides.statusCache`; first request misses and `put` is called; second request returns the cached response without hitting the db (assert via `put` called once / a counting wrapper around the read model);
  - rate limit: with the fake cache always missing, issue 121 requests from one IP (`CF-Connecting-IP` header) → last one 429.
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.** Handler skeleton:

```ts
const CACHEABLE_SECONDS = 60;
app.get("/:slug", async (context) => {
  const url = new URL(context.req.url);
  const cacheKey = new Request(url.toString());
  const cache = dependencies.cache;
  const hit = cache === undefined ? undefined : await cache.match(cacheKey);
  if (hit !== undefined) return hit;
  await enforcePublicRate(context);            // sha256 CF-Connecting-IP, RATE_LIMITS.status_page, key `status:${hash}` — copy the preAuthLimited pattern from public_api.ts
  const view = await dependencies.getPublicStatusPage.bySlug(context.req.param("slug"));
  const response =
    view === null
      ? publicHtmlResponse(renderStatusPageNotFound(), 404)
      : publicHtmlResponse(
          renderStatusPage(view, {
            canonicalUrl: `${dependencies.config.appUrl}/status/${view.slug}`,
            preview: false,
          }),
          200,
        );
  if (cache !== undefined) await cache.put(cacheKey, response.clone());
  return response;
});
```

`publicHtmlResponse` sets `Content-Type: text/html; charset=utf-8`, `Cache-Control: public, max-age=60`, the CSP above, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. `/:slug/json` identical flow but `context.json({ data: view })`-shaped `Response` with `Access-Control-Allow-Origin: *` (404 → `{ error: { code: "NOT_FOUND" } }`). Route order: register `/:slug/json` BEFORE `/:slug`.
- [ ] **Step 4: Wire in `app.ts`**: `app.route("/status", statusPublicRoutes({ getPublicStatusPage, rateLimiter, clock, config, cache: overrides.statusCache ?? caches.default }))` — construct `getPublicStatusPage` once and share with `statusPageRoutes`. Guard: in workerd `caches.default` exists; reference it lazily inside the route file if `buildApp` unit tests complain (`dependencies.cache ?? caches.default` at request time).
- [ ] **Step 5: Run** — new itest + `pnpm --filter @zenguy/api typecheck` → PASS.
- [ ] **Step 6: Commit** (`status_public.ts` + itest only if `app.ts` still shared-dirty): `git commit -m "api: status pages — ruta publica SSR y JSON con cache"`.

---

### Task 10: Deletion saga + wrangler routes

**Files:**
- Modify: `apps/api/src/infrastructure/db/workspace_deletion_repo.ts` (+ its itest `workspace_deletion_repo.itest.ts`)
- Modify: `apps/api/wrangler.jsonc`, `apps/api/src/wrangler_config.test.ts` [both SHARED-DIRTY]
- Modify: `README.md`

- [ ] **Step 1: Failing itest addition** — in `workspace_deletion_repo.itest.ts`, extend the purge assertions: seed one status page + item + incident update for the doomed workspace and one set for a survivor workspace; after the purge runs, doomed rows are gone from `status_pages`, `status_page_items`, `incident_updates`; survivor rows remain.
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @zenguy/api test:integration src/infrastructure/db/workspace_deletion_repo.itest.ts` → FAIL.
- [ ] **Step 3: Implement** — in the purge batch of `workspace_deletion_repo.ts` (the block with `DELETE FROM uptime_checks WHERE workspace_id = ?` etc.) add, keeping child-before-parent order:

```ts
db.prepare("DELETE FROM status_page_items WHERE workspace_id = ?").bind(workspaceId),
db.prepare("DELETE FROM incident_updates WHERE workspace_id = ?").bind(workspaceId),
db.prepare("DELETE FROM status_pages WHERE workspace_id = ?").bind(workspaceId),
```

- [ ] **Step 4: Wrangler routes.** In `wrangler.jsonc` add to `env.production.routes`: `{ "pattern": "app.zenguy.com/status/*", "zone_name": "zenguy.com" }`; to `env.staging.routes`: `{ "pattern": "staging-app.zenguy.com/status/*", "zone_name": "zenguy.com" }`. In `wrangler_config.test.ts` extend the route expectations for both envs.
- [ ] **Step 5: README** — add one bullet under "What Zenguy does": `**Public status pages.** Curated, publicly hosted status pages per workspace at app.zenguy.com/status/<slug>: hand-picked monitors and browser tests under public display names, 90-day incident-derived availability, and manual public incident updates.`
- [ ] **Step 6: Run** — the deletion itest, `pnpm --filter @zenguy/api test src/wrangler_config.test.ts` (only if the file is clean of foreign hunks — otherwise run but do not commit), typecheck → PASS.
- [ ] **Step 7: Commit** — `git add apps/api/src/infrastructure/db/workspace_deletion_repo.ts apps/api/src/infrastructure/db/workspace_deletion_repo.itest.ts README.md && git commit -m "api: status pages — purge en borrado de workspace y docs"` (wrangler files join only when clean).

---

### Task 11: Frontend API client + permissions

**Files:**
- Modify: `apps/frontend/src/lib/permissions.ts` (+`status_pages.manage` in `Action` + `actions` + role maps; update `permissions.test.ts`), `apps/frontend/src/lib/api.ts` (+`apiGetText`), `apps/frontend/src/api/types.ts`, `apps/frontend/src/api/incidents.ts`
- Create: `apps/frontend/src/api/status_pages.ts`
- Test: `apps/frontend/src/api/status_pages.test.ts` (mirror `uptime.test.ts` — path-building and fetch-shape tests)

**Interfaces (produced):**

```ts
// api/types.ts additions
export type StatusPageTheme = "LIGHT" | "DARK" | "SYSTEM";
export interface StatusPage {
  id: string; slug: string; title: string; description: string | null;
  accentColor: string | null; theme: StatusPageTheme;
  publishedAt: string | null; createdAt: string; updatedAt: string;
}
export interface StatusPageItem {
  id: string; resourceType: "BROWSER_TEST" | "UPTIME_MONITOR"; resourceId: string;
  displayName: string; groupName: string | null; position: number;
}
export interface StatusPageDetail extends StatusPage { items: StatusPageItem[] }
export interface IncidentUpdate { id: string; message: string; createdBy: string | null; createdAt: string }
// api/status_pages.ts functions
listStatusPages(workspaceId): Promise<StatusPage[]>
createStatusPage(workspaceId, input: { title: string; slug: string }): Promise<StatusPage>
getStatusPage(workspaceId, pageId): Promise<StatusPageDetail>
updateStatusPage(workspaceId, pageId, input: Partial<{ title; slug; description; accentColor; theme }>): Promise<StatusPage>
publishStatusPage(workspaceId, pageId): Promise<StatusPage>
unpublishStatusPage(workspaceId, pageId): Promise<StatusPage>
deleteStatusPage(workspaceId, pageId): Promise<void>
addStatusPageItem(workspaceId, pageId, input): Promise<StatusPageItem>
updateStatusPageItem(workspaceId, pageId, itemId, input): Promise<StatusPageItem>
removeStatusPageItem(workspaceId, pageId, itemId): Promise<void>
reorderStatusPageItems(workspaceId, pageId, itemIds: string[]): Promise<void>
fetchStatusPagePreview(workspaceId, pageId): Promise<string>       // apiGetText
listIncidentUpdates(workspaceId, incidentId): Promise<IncidentUpdate[]>       // in api/incidents.ts
postIncidentUpdate(workspaceId, incidentId, message): Promise<IncidentUpdate>
deleteIncidentUpdate(workspaceId, incidentId, updateId): Promise<void>
```

- [ ] **Step 1: Failing tests** for path building + response unwrapping (mirror `api/uptime.test.ts` structure and its fetch mocks). Include `apiGetText` returning raw text.
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @zenguy/frontend test src/api/status_pages.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `apiGetText` in `lib/api.ts`: copy `apiGetBlob`'s auth/refresh/error skeleton but return `response.text()`. Client functions follow `api/uptime.ts` byte-for-byte in style (`encodeURIComponent` on every path segment).
- [ ] **Step 4: Run + typecheck + permissions test** — `pnpm --filter @zenguy/frontend test src/api src/lib/permissions.test.ts && pnpm --filter @zenguy/frontend typecheck` → PASS.
- [ ] **Step 5: Commit** — `git add apps/frontend/src/lib/permissions.ts apps/frontend/src/lib/permissions.test.ts apps/frontend/src/lib/api.ts apps/frontend/src/api && git commit -m "frontend: status pages — cliente api y permisos"`.

---

### Task 12: List page + navigation + routes

**Files:**
- Create: `apps/frontend/src/pages/status_pages/StatusPagesListPage.tsx`
- Modify: `apps/frontend/src/components/Sidebar.tsx`, `apps/frontend/src/App.tsx`
- Test: `apps/frontend/src/pages/status_pages/StatusPagesListPage.test.tsx`

- [ ] **Step 1: Failing test** (mirror `UptimeListPage.test.tsx` harness — react-query provider + router + mocked api module): renders the pages returned by `listStatusPages` with title, `/status/<slug>` URL and Draft/Published badge; "New status page" opens the inline create form (title + slug inputs, slug auto-suggested from the title via `title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")`), submits `createStatusPage` and navigates to the editor; create controls hidden for MEMBER role (use the same role-mocking helper the uptime list test uses); empty state copy shown when there are no pages.
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @zenguy/frontend test src/pages/status_pages` → FAIL.
- [ ] **Step 3: Implement page** following `UptimeListPage.tsx` layout conventions (header row + cards/table + toast on error via `useMutationError`). Public URL cell: `${window.location.origin}/status/${page.slug}` with the existing `CopyButton` component. Route + nav:
  - `App.tsx`: `<Route element={<StatusPagesListPage />} path="status-pages" />` and `<Route element={<StatusPageEditorPage />} path="status-pages/:pageId" />` inside the `WorkspaceShell` block (editor component lands in Task 13 — create a minimal placeholder export in the same file location now so the route compiles, then finish it in Task 13).
  - `Sidebar.tsx`: `{ icon: Signal, label: "Status Pages", path: "status-pages" }` after Incidents (import `Signal` from `lucide-react`; no `permission` — members can view).
- [ ] **Step 4: Run + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git add apps/frontend/src/pages/status_pages apps/frontend/src/components/Sidebar.tsx apps/frontend/src/App.tsx && git commit -m "frontend: status pages — listado y navegacion"`.

---

### Task 13: Editor page (settings, items, reorder, preview, publish)

**Files:**
- Create: `apps/frontend/src/pages/status_pages/StatusPageEditorPage.tsx` (replace Task 12 placeholder), optionally split `StatusPageItemsPanel.tsx` if the file passes ~300 lines
- Test: `apps/frontend/src/pages/status_pages/StatusPageEditorPage.test.tsx`

- [ ] **Step 1: Failing tests:**
  - loads `getStatusPage` and renders settings form (title, slug, description, accent color input `type="color"` + hex text, theme select) pre-filled; saving calls `updateStatusPage` with only changed fields;
  - changing slug shows the inline warning `Changing the slug breaks the previous URL`;
  - items panel lists items in position order with display-name inline edit (calls `updateStatusPageItem`), remove buttons, and Up/Down buttons that call `reorderStatusPageItems` with the full permuted id list;
  - "Add system" opens a picker fed by `listMonitors` + `listTests` (mock both), excluding resources already on the page; choosing one pre-fills `displayName` with the internal name, lets the user edit it, and calls `addStatusPageItem`;
  - publish button calls `publishStatusPage` and flips to "Unpublish" with the public URL shown; confirm dialog before unpublish;
  - preview: after load, `fetchStatusPagePreview` is called and an `<iframe title="Status page preview" sandbox="">` receives the HTML via `srcdoc`; saving settings or items refetches the preview;
  - MEMBER role: all inputs disabled/read-only, no publish button.
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.** react-query: `useQuery(["status-page", wsId, pageId], …)` + mutations invalidating that key and a `["status-page-preview", …]` query wrapping `fetchStatusPagePreview`. Reorder via Up/Down (no drag dependency in v1):

```tsx
function moveItem(ids: string[], index: number, delta: -1 | 1): string[] {
  const next = [...ids];
  const target = index + delta;
  const current = next[index];
  const other = next[target];
  if (current === undefined || other === undefined) return ids;
  next[index] = other;
  next[target] = current;
  return next;
}
```

Preview iframe: `<iframe title="Status page preview" sandbox="" className="h-[600px] w-full rounded border" srcDoc={previewHtml ?? ""} />` (empty `sandbox` = no scripts, which the page doesn't need). Test-picker data: `listTests` lives in `api/tests.ts` (check its exported name and reuse). Use `useMutationError` for toasts and existing form styling from `MonitorFormPage.tsx`.
- [ ] **Step 4: Run + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git add apps/frontend/src/pages/status_pages && git commit -m "frontend: status pages — editor con preview y publicacion"`.

---

### Task 14: Incident public updates UI

**Files:**
- Modify: `apps/frontend/src/pages/incidents/IncidentDetailPage.tsx`
- Test: extend `apps/frontend/src/pages/incidents/IncidentDetailPage.test.tsx`

- [ ] **Step 1: Failing tests:** detail page shows a "Public updates" panel listing `listIncidentUpdates` newest-first with timestamps; a composer (textarea, char counter `n/2000`, submit disabled when empty/over limit) visible only for ADMIN/OWNER, labeled with the notice `Visible on your public status pages`; posting calls `postIncidentUpdate` and prepends the update; delete button per update (admin only) calls `deleteIncidentUpdate` after a confirm.
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @zenguy/frontend test src/pages/incidents` → FAIL.
- [ ] **Step 3: Implement** as a self-contained `PublicUpdatesPanel({ workspaceId, incidentId })` component inside the page file (or sibling file if the page is already large), using react-query + `can(role, "status_pages.manage")` from the workspace context for gating (mirror how the page already reads the role — check its imports).
- [ ] **Step 4: Run + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git add apps/frontend/src/pages/incidents && git commit -m "frontend: status pages — updates publicos en incidentes"`.

---

### Task 15: Final verification + pending shared-file commits

- [ ] **Step 1: Full suites.** `pnpm --filter @zenguy/api test && pnpm --filter @zenguy/api test:integration && pnpm --filter @zenguy/api typecheck && pnpm --filter @zenguy/frontend test && pnpm --filter @zenguy/frontend typecheck` — all PASS. Fix anything that regressed.
- [ ] **Step 2: Local smoke.** Start the API (`pnpm --filter @zenguy/api dev`, port 8790 per the local setup) and `curl -i http://localhost:8790/status/nope` → 404 HTML with the expected cache/CSP headers. If a seeded workspace exists locally, create a page through the SPA (`pnpm --filter @zenguy/frontend dev`, port 5174) and open `http://localhost:8790/status/<slug>`; otherwise note the manual QA step for Marcos.
- [ ] **Step 3: Shared files reconciliation.** `git status` — if `app.ts` / `wrangler.jsonc` / `wrangler_config.test.ts` are STILL dirty with the OAuth session's hunks, do NOT commit them; write down exactly which status-page hunks inside them remain uncommitted (route mounts, repo wiring, `/status/*` routes, config-test expectations) and surface that list to Marcos at the end. If the peer committed meanwhile, rebase-check (`git diff`) that only your hunks remain and commit them: `git add apps/api/src/app.ts apps/api/wrangler.jsonc apps/api/src/wrangler_config.test.ts && git commit -m "api: status pages — wiring y rutas /status en wrangler"`.
- [ ] **Step 4: Report.** Summarize to Marcos: what shipped, test totals, the public URL shape, pending manual QA, pending shared-file commits (if any), and that deploy (push) stays in his hands.
