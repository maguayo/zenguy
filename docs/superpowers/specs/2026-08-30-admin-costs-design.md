# Admin costs section — Cloudflare platform usage

**Date:** 2026-08-30 · **Requested by:** Marcos · **App:** `apps/admin` (+ one migration in `apps/api/migrations`)

## Goal

"Un dashboard donde ves los costes para que no se me descontrole nada: ni la base de
datos, ni el worker, ni queues." A fourth hero section, **Costes**, estimating the
Cloudflare bill from daily usage collected by a cron, so a runaway line is visible
the next morning instead of on the invoice.

## Source and truth

- Usage comes from the [GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/)
  (`POST https://api.cloudflare.com/client/v4/graphql`, account scope, token with
  `Account Analytics: Read`). Cloudflare states these datasets are not the billing
  source of truth, so every figure is labelled an estimate; the invoice is the
  dashboard's.
- Cost = usage × Workers Paid list prices minus included monthly quotas, plus the
  $5 base fee. Prices and quotas live in `src/server/costs/pricing.ts` (`LINES`,
  `BASE_FEE_CENTS`), sourced from the product pricing pages on 2026-08-28.

## Collection

- `wrangler.jsonc` `triggers.crons: ["15 2 * * *"]` → `scheduled()` in `src/index.ts`
  → `runCollection` (`src/server/costs/collection.ts`). First ever run backfills
  30 days; later runs re-collect the last 3 (late analytics, missed nights).
  Re-collecting a day overwrites it (upsert), so at-least-once cron delivery is safe.
- `PROBES` (`src/server/costs/collector.ts`): one GraphQL request per dataset,
  each parsed into `(day, metric, value)` rows; a probe failure is recorded, not
  fatal. Several fields are introspection-derived rather than documented
  (`cpuTimeUs`, DO `activeTime`, R2 `date`), so probe-level isolation is the whole
  point: the first real run tells us which ones to adjust.
- Metrics: `workers.requests|errors|subrequests|cpu_ms`, `d1.read_queries|write_queries|rows_read|rows_written|storage_bytes`,
  `do.requests|duration_gbs`, `containers.vcpu_s|memory_gib_s|disk_gb_s`,
  `kv.reads|writes|deletes|lists|storage_bytes`, `r2.class_a|class_b|storage_bytes`,
  `queues.operations`. (`email.sent` has a priced line but no known dataset yet.)
- Storage: migration `0052_platform_usage_daily.sql` — `platform_usage_daily(day, metric, value, collected_at)`
  and `platform_usage_collections(id, source, status, from_day, to_day, started_at, finished_at, details_json)`.
  Admin-owned tables in the production D1, like `admin_sessions`; the product API ignores them.
- Config: var `CLOUDFLARE_ACCOUNT_ID`; secret `CF_ANALYTICS_API_TOKEN` is **optional**
  (not in `secrets.required`) so deploys never block on it; unconfigured → the
  section shows the setup steps and `POST /api/costs/refresh` answers 503.

## API

- `GET /api/costs?days=7|30|90` → `Costs`: `month` (key, from, to, daysElapsed, daysInMonth),
  `baseFeeCents`, `totalCents`, `projectedCents` (linear to month end), `topLine`,
  `lastCollection` (with per-probe results), `collectorConfigured`, `lines[]`
  (monthToDate, included, overage, unitPriceCents, costCents per line) and `series[]`
  (per day, marginal cents per line once the month's quota is crossed).
- `POST /api/costs/refresh` → runs a 30-day manual collection, returns the record.
  Session-guarded like every data route.

## UI

Hero pattern (`CostsHero`): widgets **Coste estimado (mes)** (with projection and
base fee), **Línea más cara**, **Última recogida** (red when older than 2 days or
failed, lists failing probes); chart: stacked bars of marginal cost per day by line;
footer: table of lines with usage (idle lines hidden) and the "Actualizar ahora"
button with probe diagnostics. Global 7/30/90 selector applies to the series.

## Testing

Unit: pricing math (quota, storage average, daily attribution), collector parsing
per dataset and failure isolation, GraphQL client, routes, hero rendering.
Integration (real migrations): usage store upsert/read, `runCollection` end to end
with a fake fetch. Gate: `pnpm --filter @zenguy/admin typecheck && test && test:integration`.

## Out of scope

Exact invoice reconciliation; alerting on thresholds (a natural follow-up: a daily
projection above a limit → email); email-sending usage (no dataset located).
