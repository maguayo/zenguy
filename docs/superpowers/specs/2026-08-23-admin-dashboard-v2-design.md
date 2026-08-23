# Zenguy Admin v2 — Panel de negocio (admin.zenguy.com)

**Fecha:** 2026-08-23
**Estado:** aprobado por delegación ("haz el panel que te gustaría ver")
**Base:** `docs/superpowers/specs/2026-08-21-admin-dashboard-design.md` (v1, desplegada)

## 1. Objetivo

Convertir el panel v1 (KPIs instantáneos + listas) en un panel que muestre **cómo va el
negocio en el tiempo**: usuarios, actividad, runs y checks por día con éxito/fallo, coste de
LLM, incidentes, alertas e ingresos; y una monitorización clara de los workers.

Sigue siendo: solo lectura, solo producción, un Worker (`zenguy-admin`), SELECT explícitos, sin
columnas secretas. No cambia nada del login ni de la sesión (otra sesión está reescribiendo
esa parte: Access JWT + sesiones server-side; este diseño no la toca).

## 2. Qué se ve (una sola página, de arriba abajo)

Selector global de rango para las series: **7 d / 30 d / 90 d** (por defecto 30 d). Todas las
series son por día UTC, con ceros rellenados para los días sin datos.

1. **Cabecera**: "Zenguy Admin · Production", frescura ("updated 12s ago" / "stale"), rango,
   email, sign out.
2. **KPIs** (8 tarjetas, cada una con valor, delta y mini-sparkline de 14 días):
   - Users (total · +N en 7 d) · Active users 7 d (distintos con refresh token) ·
     Workspaces (activos) · Paying (suscripciones `source='paddle'` ACTIVE) + MRR estimado
     (`PLAN_PRICE_CENTS` × paying) · Runs today (con pass rate) · Checks today (uptime %) ·
     Open incidents · Workers online / total.
3. **Growth**: gráfica "Users" (área acumulada de usuarios + barras de altas por día) y
   gráfica "Active users" (DAU = usuarios distintos con `refresh_tokens.created_at` ese día;
   WAU = ventana móvil 7 d).
4. **Browser runs**: barras apiladas por día `PASSED / FAILED / TIMEOUT / SYSTEM_ERROR` con
   línea de pass rate; gráfica "Run cost": tokens LLM por día (input+output, de
   `test_attempts`) y duración media.
5. **Uptime**: barras apiladas checks `up / down` por día + línea de respuesta media;
   tarjeta de estado actual de monitores (UP/DOWN/UNKNOWN) y "monitors down now" con nombre
   y workspace.
6. **Incidents & alerts**: incidentes abiertos por día y abiertos ahora (con edad); entregas
   de notificación por día por canal (`EMAIL / SMS / WHATSAPP / CALL / SLACK / DISCORD / PUSH`)
   y coste (`cost_cents`) — control de gasto Twilio.
7. **Workers**: tarjeta por worker (online/offline con semáforo, modo, versión, visto hace X,
   uptime, run en curso) + **runs en las últimas 24 h / 7 d por worker** y tokens; tabla de
   atribución (`runner_kind` primary vs fallback por día en la gráfica de runs como línea
   opcional "fallback share").
8. **Tablas**: Top failing tests (7 d: fallos, total, pass rate, workspace), Slowest tests
   (7 d media), Most active workspaces (runs 30 d, monitores, último run), Recent runs
   (50), Users (50, última actividad).

Estados: vacío por sección ("No runs in this range"), `MIGRATION_PENDING` donde aplique
(workers), "stale" cuando un refetch falla (se mantiene el último dato).

## 3. API (`/api/*`, tras la misma guardia de sesión que el resto)

Un endpoint nuevo para todas las series, para no multiplicar llamadas:

`GET /api/analytics?days=7|30|90` → `{ data: Analytics }`

```ts
interface DayPoint { day: string /* YYYY-MM-DD UTC */ }
interface Analytics {
  range: { days: number; from: string; to: string; now: number };
  users:   Array<DayPoint & { signups: number; cumulative: number; dau: number; wau: number }>;
  runs:    Array<DayPoint & { passed: number; failed: number; timeout: number; systemError: number;
                              total: number; fallback: number; avgDurationMs: number | null;
                              inputTokens: number; outputTokens: number }>;
  checks:  Array<DayPoint & { up: number; down: number; avgResponseMs: number | null }>;
  incidents: Array<DayPoint & { opened: number; resolved: number }>;
  deliveries: Array<DayPoint & { byChannel: Record<ChannelType, number>; costCents: number }>;
  business: { payingWorkspaces: number; mrrCents: number; freeWorkspaces: number;
              grantWorkspaces: number; creditTopupsCents30d: number; openIncidents: number;
              activeUsers7d: number; activeUsers30d: number };
  topFailingTests: Array<{ testId: string; name: string; workspaceName: string | null;
                           runs: number; failed: number; passRate: number | null }>;
  slowestTests:    Array<{ testId: string; name: string; workspaceName: string | null;
                           runs: number; avgDurationMs: number }>;
  activeWorkspaces: Array<{ workspaceId: string; name: string; runs: number; monitors: number;
                            lastRunAt: number | null; subscription: string }>;
  monitorsDown: Array<{ monitorId: string; name: string; workspaceName: string | null;
                        since: number | null }>;
  openIncidents: Array<{ incidentId: string; resourceType: string; resourceName: string | null;
                         workspaceName: string | null; openedAt: number }>;
}
```

- Agregación por día en SQL: `strftime('%Y-%m-%d', created_at/1000, 'unixepoch')`, una consulta
  por tabla acotada por `>= from` (usa los índices de `0024`), relleno de días en memoria.
- `cumulative` de usuarios = total de usuarios creados antes del rango + acumulado diario.
- `dau` = `COUNT(DISTINCT user_id)` en `refresh_tokens` por día; `wau` se calcula en memoria
  sobre los distintos por día → aproximación: suma móvil de 7 días de DAU no es WAU exacta;
  se calcula WAU exacto con una segunda consulta `COUNT(DISTINCT user_id)` por ventana móvil
  solo para los últimos 14 días (coste acotado) y `null` para el resto. **Simplificación
  adoptada:** WAU exacta solo en la serie de 14 días de los KPIs; en la gráfica se muestra DAU
  y la línea WAU de los últimos 14 días.
- Tokens: `SUM(input_tokens)`, `SUM(output_tokens)` de `test_attempts` unidos a `test_runs`
  por día del run (`finished_at` del attempt si existe, si no `created_at`).
- Workers: `GET /api/workers` gana `runs24h`, `runs7d`, `tokens24h` por worker
  (`test_attempts.claimed_by_runner_id`), manteniendo la forma actual.
- Degradación: si falta `claimed_by_runner_id`/`runner_kind`/`input_tokens` (esquema
  antiguo), esos campos van a 0/`null`, nunca 500. Producción ya está en 0024, así que es
  solo defensa.
- `days` valida `7|30|90`; cualquier otro valor → 400.

## 4. Cliente

- `recharts` (misma librería que `apps/frontend`), paleta del producto (indigo como acento
  único; verde/rojo/ámbar solo para estados). Reglas de `dataviz`: un sistema, ejes y
  tooltips consistentes, sin 3D ni degradados.
- Estructura: `pages/DashboardPage` orquesta; componentes puros por sección en
  `components/`; `lib/series.ts` con los helpers puros (relleno de días, deltas, sparkline,
  pass rate, formato de tokens/€) testeados con vitest; gráficas con `ResponsiveContainer`.
- Polling: analytics 60 s, workers 5 s, overview 30 s, recientes 30 s, usuarios 60 s.
- Rango persistido en `localStorage` (`zenguy-admin:range`).
- Tests: helpers y componentes no-gráficos con `renderToStaticMarkup`; las gráficas se
  verifican con build + smoke en navegador (recharts no mide contenedores en SSR).

## 5. Seguridad / rendimiento

- Solo SELECT; columnas explícitas; nada de `encrypted_*`, hashes, URLs de pago.
- Cada serie es una consulta acotada por fecha; el endpoint completo debe quedar por debajo de
  ~15 statements. `days=90` es el máximo.
- Nombres de test/workspace son PII de cliente ya autorizada en v1.

## 6. Plan de ejecución

- **S (servidor)**: `src/server/db/analytics.ts` (+ `analytics.itest.ts` con fixture
  multi-día), ampliación de `db/workers.ts` (+ itest), `src/server/routes/analytics.ts`
  (+ test con guardia fake), tipos en `src/shared/types.ts`, wiring de 2 líneas en `app.ts`.
- **U (cliente)**: `lib/series.ts` (+ tests), `api.ts`, `components/charts/*`,
  secciones nuevas, `DashboardPage` reorganizada, selector de rango.
- Revisión, smoke en Chrome con D1 local (stub de login), deploy del Worker desde esta rama
  (la producción actual es HEAD + Access, consistente), merge a `main` cuando la sesión de
  seguridad haya commiteado su reescritura (el wiring en `app.ts` es el único solape).
