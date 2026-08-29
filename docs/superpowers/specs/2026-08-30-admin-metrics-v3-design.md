# Admin metrics v3 — hero sections

**Date:** 2026-08-30 · **Requested by:** Marcos (session 29-08 night) · **App:** `apps/admin` only

## Goal

Replace the top of admin.zenguy.com with three "hero" sections in the layout Marcos described:
each section is a left column of **3 stacked KPI widgets** plus a **large chart filling the rest
of the row**. Below the heroes, the existing operational sections (Workers, Recent runs, Users
table) stay. The old `KpiGrid`, `RunsWindowsSection` and `UptimeSection` widgets are replaced.

A global range selector (7 / 30 / 90 days, default 30, persisted to
`localStorage["zenguy-admin:range"]`) drives every hero. Chart infrastructure (recharts theme,
card/pair primitives, tooltips, axes) is ported from the unmerged `admin-v2` branch — reference
implementation, not a merge; the server stays main's hardened one (Access JWT + `ADMIN_USER_IDS`
+ D1 `admin_sessions`).

## Sections

### 1. Usuarios
| Widget | Definition |
| --- | --- |
| Registrados | `COUNT(users)` total; delta = signups inside the selected range |
| Activos (7d) | distinct users with life signals in the last 7 days: `refresh_tokens.created_at` ∪ `activity_events.user_id/occurred_at` |
| Danger | users with `created_at ≤ now−14d` AND no refresh token AND no activity event in the last 14 days (Marcos: "inactivos 14+ días") |

Chart: cumulative registered users (area) + daily signups (bars) over the range.

### 2. Browser Tests
| Widget | Definition |
| --- | --- |
| Totales | `test_runs` created inside the range |
| Tests por Usuario | range runs ÷ distinct `workspaces.owner_user_id` of workspaces with ≥1 run in range (1 decimal) |
| Fallidos (2h) | runs `created_at ≥ now−2h` with status `FAILED`, `TIMEOUT` or `SYSTEM_ERROR` |

Chart: **stacked bars** per day — `PASSED` / `FAILED` / `TIMEOUT` / `SYSTEM_ERROR` (+ in-progress
rest) — with an average-duration companion rail.

Footer row (two cards):
- **Reintentos** — share of passing runs whose passing attempt was `attempt_index` 0 / 1 / ≥2
  (from `test_attempts`, `status='PASSED'`, joined to range runs). Shown as `1ª · 2ª · 3ª+`.
- **Gasto estimado** — hoy / 7d / 30d (independent of the selector). The DB stores per-attempt
  `input_tokens` / `output_tokens` / `model_name` but **no cost**; € = tokens × per-model rates in
  `MODEL_PRICES` (`src/server/constants.ts`), with a default rate for unknown models. Labelled
  "estimado" in the UI.

### 3. Uptime
| Widget | Definition |
| --- | --- |
| Uptime % | `PASSED / total` over `uptime_checks.checked_at` in range |
| Monitores DOWN | `uptime_monitors.current_status='DOWN' AND deleted_at IS NULL`, hint shows total live monitors |
| Incidentes abiertos | `incidents.status='OPEN'` |

Chart: stacked up/down bars per day (`uptime_checks.status` PASSED→up, FAILED→down) with an
average `response_time_ms` rail.

## API

One endpoint, mounted with the existing per-route `guard` in `routes/data.ts`:

```
GET /api/metrics?days=7|30|90        (default 30; anything else → VALIDATION_ERROR)
→ { data: {
     range: { days, from, to, now },
     users:  { registered, newInRange, active7d, danger,
               series: [{ day, signups, cumulative }] },
     tests:  { total, perUser, failed2h,
               retries: { first, second, thirdPlus },
               spendCents: { today, last7d, last30d },
               series: [{ day, passed, failed, timeout, systemError, total, avgDurationMs }] },
     uptime: { upPercent, monitorsDown, monitorsTotal, openIncidents,
               series: [{ day, up, down, avgResponseMs }] } } }
```

Series carry exactly `days` UTC points, oldest first, zero-filled in TS (not SQL). Loader
`src/server/db/metrics.ts`: one `loadMetrics(db, now, days)` firing its statements in a single
`Promise.all`, reusing the v2 idioms — `strftime('%Y-%m-%d', col/1000, 'unixepoch')` day buckets
and `GROUP BY +column` where an index would otherwise hijack the plan. Token/attempt reads are
wrapped so a database missing migration `0021` degrades to zeros instead of failing the endpoint
(v2 `isMigrationPendingError` pattern).

## Client

- New dep: `recharts ^3.10.1` (same as v2). React/Tailwind/TanStack stack unchanged.
- Ported from `admin-v2` (adapted, committed here): `charts/theme.ts`, `charts/parts.tsx`
  (`ChartCard`, `PlotPair`, `SinglePlot`, `DayTooltip`, `ChartLegend`, axis props),
  `charts/axes.tsx` formatters, `RangeSwitch` + `lib/range.ts`.
- New: `KpiWidget` (label / big tabular-nums value / hint / optional delta),
  `HeroSection` (grid: `lg:` 3 widgets stacked in a ~16rem column + chart filling the rest;
  stacks vertically below `lg`), `UsersHero`, `TestsHero` (incl. retries + spend footer),
  `UptimeHero`, `lib/series.ts` shaping (payload → chart points, % math, € formatting).
- `DashboardPage`: range state + `["metrics", range]` query (`placeholderData` keeps the previous
  range on screen), heroes on top, then Workers / Recent runs / Users. `KpiGrid`,
  `RunsWindowsSection`, old `UptimeSection` and `Windows.tsx` are deleted with their tests.
- `/api/overview` stays (Workers section consumes its windows? — verify; delete the loader only
  if nothing else consumes it).

## Testing

TDD throughout. Server: `metrics.itest.ts` against the real `apps/api/migrations` (seeded users,
runs, attempts, checks, incidents; asserts every widget number, retry split, spend math and
zero-filled series), route test for the `days` validation + envelope, plan-pin itest
(`EXPLAIN QUERY PLAN`) for the two `GROUP BY +` statements. Client: section tests in the existing
`sections.test.tsx` style + `lib/series.test.ts` + range tests. Gate before commit:
`pnpm --filter @zenguy/admin typecheck && test && test:integration`.

## Out of scope

v2's leaderboards, alert-delivery charts, activity feed, workspaces table and MRR/business strip;
dark mode (the admin is explicitly light-only); any `apps/api` change (the orphaned OAuth WIP and
Status Pages hunks stay untouched); pushing/deploying (Marcos' explicit go required).
