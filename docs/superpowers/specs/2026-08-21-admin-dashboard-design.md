# Zenguy Admin — Diseño del panel de administración (admin.zenguy.com)

**Fecha:** 2026-08-21
**Estado:** aprobado en conversación; pendiente de plan de implementación
**Alcance:** panel interno de administración de plataforma, solo lectura, entorno de producción

---

## 1. Objetivo

Dar al operador de Zenguy (admin de plataforma, no admin de workspace) un panel en
`admin.zenguy.com` con:

1. Usuarios registrados: total, verificados, altas recientes y última actividad por usuario.
2. Métricas de runs de Browser Tests: ejecutados en la última 1h / 3h / 24h (desglose por
   estado, pass rate, duración media) y previstos para la próxima 1h / 3h / 24h.
3. Métricas de Uptime: checks ejecutados y previstos en las mismas ventanas, más el estado
   actual de los monitores (UP / DOWN / UNKNOWN).
4. Salud de los workers externos (`browser_worker.py`): cada worker reporta un heartbeat
   cada 5 segundos; el panel muestra online/offline en tiempo casi real.
5. Atribución de ejecución: qué worker ha cogido cada run/attempt.

### No-goals de V1

- Ninguna acción de escritura desde el panel (solo lectura).
- Visibilidad de staging (decisión explícita: solo producción).
- Gráficas históricas más allá de las ventanas 1h/3h/24h.
- Alertas propias del panel.
- Multi-admin con roles; la lista `ADMIN_EMAILS` es suficiente.

## 2. Decisiones tomadas (con el usuario)

| Decisión | Elección |
| --- | --- |
| Ubicación | App separada en `admin.zenguy.com`, no dentro de `apps/frontend` |
| Alcance de métricas | Browser Tests **y** Uptime |
| Autenticación | Cuentas Zenguy existentes + allowlist `ADMIN_EMAILS` |
| Entornos visibles | Solo producción |
| Heartbeat | Cada 5 s, según pidió el usuario |

## 3. Arquitectura

Tres piezas, cada una en su repositorio actual de responsabilidad:

```
browser_worker.py ──(heartbeat 5s, claim con workerId)──▶ apps/api (/api/runner/*) ──▶ D1 producción
                                                                                        ▲
admin.zenguy.com (apps/admin, Worker nuevo) ── solo SELECT ─────────────────────────────┘
        │
        └── login delegado ──▶ POST {ZENGUY_API_ORIGIN}/api/auth/login (producción)
```

1. **`apps/admin` (nuevo):** un único Cloudflare Worker `zenguy-admin` con
   `custom_domain: admin.zenguy.com` que sirve el frontend React vía Workers Assets y
   expone su API Hono en `/api/*`. Un solo deployable; sin proyecto de Pages.
2. **`apps/api` (cambios quirúrgicos):** el protocolo runner gana heartbeat e identidad de
   worker. El admin no añade endpoints aquí.
3. **`runner/browser_worker.py` (cambios):** hilo de heartbeat + envío de `workerId` en los
   claims, en modo normal y en modo `--fallback`.

El Worker admin se vincula **en solo lectura por convención** (D1 no distingue permisos por
binding; el código del admin solo ejecuta SELECT) a la base D1 de producción
(`zenguy-db`, la misma `database_id` que usa el entorno de producción de `apps/api`).

## 4. Autenticación y autorización del panel

`admin.zenguy.com` es un origen distinto de `app.zenguy.com`, así que la sesión JWT del
producto no viaja. Para reutilizar cuentas sin ampliar el ámbito de las cookies de clientes
(no se cambia `Domain` de ninguna cookie existente):

1. Página de login propia en `admin.zenguy.com` (email + password).
2. El Worker admin reenvía las credenciales **servidor a servidor** a
   `POST {ZENGUY_API_ORIGIN}/api/auth/login` (producción, por defecto
   `https://api.zenguy.com`). Un 200 significa credenciales válidas; los tokens de la
   respuesta se descartan.
3. El Worker admin comprueba que el email (normalizado a minúsculas; en D1 la columna es
   `COLLATE NOCASE`) está en `ADMIN_EMAILS` (var, lista separada por comas). Si no está:
   403 con error genérico, sin revelar si la cuenta existe.
4. Si pasa, emite su propia sesión: cookie `zenguy_admin_session`, HttpOnly, Secure,
   SameSite=Lax, Path=/, caducidad 7 días. Contenido: `base64url(payload) + "." +
   base64url(HMAC-SHA256(payload, ADMIN_SESSION_SECRET))` con payload `{email, exp}`.
   Verificación con comparación timing-safe.
5. `POST /api/auth/logout` borra la cookie. `GET /api/auth/me` devuelve `{email}` si la
   sesión es válida.
6. Todos los demás endpoints del admin exigen sesión válida (middleware).

En fallos de login se responde con error genérico y un retardo fijo (~300 ms). El rate
limiting real lo aporta el endpoint de login de `apps/api`, que es quien valida.

**Dependencia explícita:** hasta que la API de producción esté activa (hoy está pendiente
de sus gates de release), el login del admin no puede validar credenciales. `ZENGUY_API_ORIGIN`
es una var para poder apuntar a otro origen en pruebas locales.

## 5. Cambios en `apps/api`

### 5.1 Migración `0018_runner_workers.sql`

```sql
CREATE TABLE runner_workers (
  id TEXT PRIMARY KEY,              -- workerId reportado
  mode TEXT NOT NULL CHECK (mode IN ('local','fallback')),
  version TEXT NOT NULL,
  started_at INTEGER NOT NULL,      -- arranque del proceso worker
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

ALTER TABLE test_attempts ADD COLUMN claimed_by_runner_id TEXT;
```

Se aplica a staging ya; a producción cuando se ejecute su release normal (las migraciones
0009–0017 siguen pendientes allí por los gates existentes; este diseño no los altera).

### 5.2 Protocolo runner

- Nuevo `POST /api/runner/heartbeat` bajo la misma auth `RUNNER_API_TOKEN` existente.
  Body validado con zod: `{ workerId, mode: "local"|"fallback", version, startedAt }` con
  `workerId` limitado a `^[A-Za-z0-9._-]{1,64}$`. Efecto: UPSERT en `runner_workers`
  actualizando `last_seen_at` (y `first_seen_at` solo al insertar). Respuesta `{ data: { ok: true } }`.
- `claim` y `claim-stale` aceptan `workerId` **opcional** (mismo formato). Si llega, se
  persiste en `test_attempts.claimed_by_runner_id` al conceder el claim. Retrocompatible:
  un worker antiguo sin `workerId` sigue funcionando.
- Umbral de "online" definido como constante compartida: `RUNNER_ONLINE_THRESHOLD_MS = 15_000`
  (3 heartbeats perdidos). La constante vive en `apps/api/src/shared/constants.ts` como
  referencia canónica; el admin replica el valor documentado (no hay paquete compartido
  entre apps en el monorepo y no se va a crear para una constante).

Coste de escritura: 1 UPSERT / 5 s / worker ≈ 17k filas/día por worker. Despreciable para D1.

### 5.3 Sin endpoints admin en `apps/api`

Todas las consultas del panel viven en el Worker admin, que lee D1 directamente. Esto evita
exponer datos cross-tenant desde la API de clientes.

## 6. Cambios en el worker Python (`runner/browser_worker.py`)

- `WORKER_ID`: configurable (clave nueva opcional en `.browser_worker.local.json` o env);
  por defecto el hostname saneado al formato permitido.
- Hilo daemon de heartbeat: cada 5 s hace `POST /api/runner/heartbeat` con
  `{workerId, mode, version, startedAt}`. `mode` es `local` en ejecución normal y
  `fallback` en `--fallback`. Un fallo de red se loguea (evento JSON compacto, como el
  resto del worker) y no interrumpe ni el hilo ni el proceso; el siguiente tick reintenta.
- El hilo arranca tras validar configuración y se detiene con el proceso (daemon). En
  `--once` también se emite al menos un heartbeat al empezar.
- `claim` y `claim-stale` incluyen `workerId`.

## 7. API del Worker admin (`apps/admin`, rutas `/api/*`)

Todas con sesión admin salvo login. Respuestas `{ data: ... }` y `Cache-Control: no-store`,
siguiendo el estilo de `apps/api`.

| Endpoint | Contenido |
| --- | --- |
| `POST /api/auth/login` | Flujo de la sección 4 |
| `POST /api/auth/logout` | Borra cookie |
| `GET /api/auth/me` | `{ email }` |
| `GET /api/overview` | KPIs + ventanas (ver 7.1) |
| `GET /api/workers` | Workers con estado online y attempt en curso (ver 7.2) |
| `GET /api/users?limit=50` | Usuarios con última actividad (ver 7.3) |
| `GET /api/runs/recent?limit=50` | Últimos runs con atribución de worker (ver 7.4) |

### 7.1 `GET /api/overview`

```jsonc
{
  "data": {
    "users":      { "total": n, "verified": n, "newLast7d": n },
    "workspaces": { "total": n },
    "browserTests": { "active": n },
    "uptimeMonitors": { "total": n, "up": n, "down": n, "unknown": n },
    "browserRuns": {
      "past":     { "h1": { "total": n, "byStatus": {...}, "passRate": x, "avgDurationMs": n }, "h3": {...}, "h24": {...} },
      "upcoming": { "h1": n, "h3": n, "h24": n }
    },
    "uptimeChecks": {
      "past":     { "h1": { "total": n, "up": n, "down": n, "avgResponseMs": n }, "h3": {...}, "h24": {...} },
      "upcoming": { "h1": n, "h3": n, "h24": n }
    }
  }
}
```

- **Pasado (browser):** `test_runs` con `created_at` en la ventana, agrupado por `status`;
  `passRate = PASSED / total` sobre runs terminados; duración media sobre `duration_ms` no nulos.
- **Pasado (uptime):** `uptime_checks` con `checked_at` en la ventana.
- **Futuro:** expansión de ocurrencias con una función pura compartida por ambos recursos:
  para cada recurso activo (no borrado), `countOccurrences(nextAt, intervalMs, now, windowEndMs)`
  cuenta cuántas ejecuciones caen en `[now, windowEnd]`, incluyendo las atrasadas
  (`nextAt < now` cuenta como 1 más las siguientes dentro de la ventana). Browser:
  `next_run_at` + `interval_hours`; uptime: `next_check_at` + `frequency_seconds`.
  Cotas: 24 ocurrencias máx/test (intervalo mínimo 1 h) y 288 máx/monitor (frecuencia
  mínima 5 min) en la ventana de 24 h; se calcula en memoria sobre los recursos activos.

### 7.2 `GET /api/workers`

Por worker: `id`, `mode`, `version`, `startedAt`, `firstSeenAt`, `lastSeenAt`,
`online` (`now - last_seen_at < 15_000`), y `currentAttempt` (attempt en `STARTING`/`RUNNING`
con `claimed_by_runner_id = id`, incluyendo `runId`, test y workspace) o `null`.

### 7.3 `GET /api/users`

Por usuario: `email`, `name`, `createdAt`, `emailVerified`, `workspaceCount`,
`lastActiveAt = MAX(refresh_tokens.created_at)` del usuario (la rotación de refresh ocurre
como muy tarde cada ~30 min de uso activo, precisión suficiente sin migrar ni tocar el hot
path de auth; `null` si no hay tokens, mostrado como "sin datos"). Orden: última actividad
descendente. `limit` 1–200, default 50.

### 7.4 `GET /api/runs/recent`

Últimos N `test_runs` (default 50) con: fecha, workspace (nombre), test (nombre), `source`,
`status`, `duration_ms`, `attempt_count`, `passed_after_retry` y el `claimed_by_runner_id`
del último attempt (el worker que lo ejecutó).

## 8. Degradación controlada en producción

La D1 de producción está hoy en la migración 0008. El panel debe funcionar sin romperse:

- Consultas sobre tablas/columnas que aún no existen (`runner_workers`,
  `claimed_by_runner_id`) se envuelven: si D1 devuelve error de esquema, la sección
  correspondiente responde `{ "unavailable": "MIGRATION_PENDING" }` y la UI muestra
  "Pendiente de activar en producción". El resto del panel sigue funcionando.
- Si la API de producción no responde al login delegado, la página de login muestra un
  error claro de "API de producción no activa".
- Estados vacíos correctos en todas las secciones (0 usuarios, 0 workers, etc.).

## 9. Frontend del panel

React + Vite + Tailwind (mismas versiones que `apps/frontend`), `@tanstack/react-query`.
Una sola página tras el login, con secciones:

1. **KPIs**: usuarios, workspaces, tests activos, monitores por estado.
2. **Workers**: tarjeta por worker con badge verde/rojo, "visto hace Xs", modo, versión y
   run en curso mostrado como texto (id de run + nombre de test); no se enlaza a la app de
   clientes porque el admin no es miembro de esos workspaces. Refetch cada 5 s.
3. **Browser runs**: pasado 1h/3h/24h (desglose + pass rate + duración media) y próximos
   1h/3h/24h. Refetch 30 s.
4. **Uptime**: mismas ventanas para checks + estado de monitores. Refetch 30 s.
5. **Usuarios**: tabla ordenada por última actividad. Refetch 60 s.
6. **Runs recientes**: feed con estado, test, workspace, duración y worker. Refetch 30 s.

Rutas: `/login` y `/` (protegida; sin sesión redirige a `/login`). Sin más navegación en V1.

## 10. Seguridad

- El Worker admin nunca ejecuta mutaciones sobre D1 de producción (solo SELECT).
- Nunca se leen ni devuelven `password_hash`, valores de secrets, configs cifradas ni
  tokens; las consultas seleccionan columnas explícitas.
- `ADMIN_EMAILS` se comprueba en servidor en cada login; la sesión firmada se verifica en
  cada request con comparación timing-safe.
- Cabeceras de seguridad equivalentes a las de `apps/api` (`securityHeaders`), CSP estricta
  para la SPA, `Cache-Control: no-store` en `/api/*`.
- No se amplía el `Domain` de ninguna cookie del producto; la sesión admin es host-only.
- Secrets del Worker admin: `ADMIN_SESSION_SECRET` (≥32 chars). Vars: `ADMIN_EMAILS`
  (valor inicial: `marcos@aguayo.es`), `ZENGUY_API_ORIGIN`.
- Los datos mostrados (emails de clientes) son PII: solo accesibles tras sesión admin.

## 11. Testing (TDD, como el resto del repo)

- **`apps/api`** (vitest + itest existentes): heartbeat 401 sin token; heartbeat crea y
  actualiza `runner_workers` (first_seen estable, last_seen avanza); claim persiste
  `workerId`; claim sin `workerId` sigue aceptándose; validación zod de formatos.
- **Python** (`runner/test_browser_worker.py`): el hilo emite con el intervalo configurado;
  un fallo HTTP no rompe el bucle; payload correcto por modo; `claim` incluye `workerId`;
  saneado del hostname.
- **`apps/admin` backend**: unit — `countOccurrences` (casos: nextAt futuro/pasado/fuera de
  ventana, límites exactos), firma/verificación/caducidad de cookie, parseo de
  `ADMIN_EMAILS`, umbral online; integración con D1 local aplicando las migraciones reales
  de `apps/api` — shapes de overview/users/runs, degradación `MIGRATION_PENDING` cuando
  falta 0018, middleware (sin cookie 401, cookie corrupta 401, login de email no admin 403,
  login delegado con API caída → error controlado).
- **`apps/admin` frontend**: render de login, redirección sin sesión, render de secciones
  con datos mock incluyendo estados vacíos y `MIGRATION_PENDING`.

## 12. Despliegue y activación

1. `apps/admin` se añade al workspace pnpm (glob `apps/*` ya lo cubre) con scripts
   `dev`/`build`/`test`/`typecheck`/`deploy` coherentes con las demás apps.
2. Deploy manual: `pnpm --filter @zenguy/admin exec wrangler deploy --profile zenguy-personal`.
   El `custom_domain` provisiona `admin.zenguy.com` en la zona existente.
3. Instalar `ADMIN_SESSION_SECRET` (secret) y configurar `ADMIN_EMAILS` (var; valor
   inicial: `marcos@aguayo.es`).
4. `apps/api`: aplicar `0018` en staging y desplegar staging para que los workers empiecen
   a reportar (visible en el panel cuando producción se active o si se apunta una copia del
   panel a staging). Producción sigue sus gates de release normales.
5. El worker Python actualizado emite heartbeats en cuanto se ejecute.

**Estado esperado el día 1:** el panel desplegado contra producción mostrará login
inoperativo hasta activar la API de producción (dependencia documentada en §4) y secciones
de datos vacías/`MIGRATION_PENDING` hasta completar el release de producción. Es la
consecuencia aceptada de la decisión "solo producción"; la estructura (var de origen y
binding D1) permite montar un admin de staging idéntico si algún día se quiere.

## 13. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Acoplamiento de esquema (el admin consulta tablas de `apps/api`) | Consultas centralizadas en un módulo `db/` del admin con tests de integración contra las migraciones reales |
| Deriva del umbral online entre apps | Constante canónica en `apps/api` + test que documenta el valor en el admin |
| Login delegado depende de la API de producción | Error claro en UI; `ZENGUY_API_ORIGIN` configurable |
| Cookie de sesión robada | HttpOnly + Secure + SameSite=Lax + caducidad 7 d; sin persistencia server-side que invalidar en V1 (aceptado para un solo admin) |
| Escrituras de heartbeat crecen con más workers | 1 fila UPSERT / 5 s / worker; lineal y despreciable a la escala prevista |
