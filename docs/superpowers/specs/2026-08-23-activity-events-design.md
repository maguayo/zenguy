# Zenguy — Diseño de eventos de actividad (`activity_events`)

**Fecha:** 2026-08-23
**Estado:** aprobado e implementado el 2026-08-23 (plan: `docs/superpowers/plans/2026-08-23-activity-events.md`); esta versión recoge las decisiones tomadas durante la implementación
**Alcance:** API (`apps/api`), webapp (`apps/frontend`), app iOS (`apps/app`) y panel admin (`apps/admin`). Nada público: ni website, ni landing, ni páginas de login.

---

## 1. Objetivo

Poder responder, desde el panel admin y con SQL directo sobre D1, preguntas como:

- ¿Cuándo fue la última vez que un workspace (o un usuario) estuvo activo?
- ¿Cuándo navegaron por última vez por la webapp? ¿Y por la app iOS? ¿Qué pantallas?
- ¿Cuándo creó/editó/borró por última vez un workspace un Browser Test, un monitor, un canal de alertas?
- ¿Cuándo se ejecutó por última vez un Browser Test y con qué resultado?
- ¿Cuándo hizo login por última vez cada usuario? ¿Cuándo invitó a alguien?
- ¿Qué está pasando ahora mismo en la plataforma? (feed en vivo)

Para ello se introduce el concepto **evento de actividad**: un hecho atómico, con fecha, tipo, usuario actor (cuando lo hay), workspace (cuando aplica) y recurso, almacenado en una tabla append-only de D1 consumida solo internamente.

### Lo que NO es

- **No es el audit log.** `audit_logs` sigue siendo el registro de acciones sensibles visible para el workspace, con anonimización en borrado y semántica legal. Los eventos de actividad son analítica interna, de alto volumen y con retención corta.
- **No es product analytics de terceros.** No se añade ningún SDK (coherente con el spec de la app móvil §4.8).
- **No es tracking público.** Ningún evento se emite sin usuario autenticado. El website (`apps/website`, `apps/landing`), las páginas de sign-in/sign-up/forgot/reset y las páginas públicas de invitaciones y grants quedan fuera.

### No-goals de V1

- Endpoint de lectura de eventos para clientes (el único lector es el admin, vía D1).
- Cola offline en la app: si no hay red, las visitas se pierden.
- Contadores agregados o tablas rollup (`last_*_at` desnormalizados). Se contempla como evolución (§15).
- Eventos del panel admin sobre sí mismo.

## 2. Decisiones y supuestos

| Decisión | Elección | Motivo |
| --- | --- | --- |
| Almacenamiento | Tabla `activity_events` en la misma D1 | El admin ya lee la D1 de producción; "última vez que X" es un seek de índice |
| Relación con audit | Tabla separada; **puente** desde `WriteAudit` para no tocar 33 use cases | DRY y exhaustividad forzada por tipos (`satisfies Record<AuditAction, …>`) |
| Eventos de cliente | `POST /api/me/events` en lote, fire-and-forget, solo cuentas verificadas | Un write de D1 por lote, cero impacto en navegación |
| Marca de tiempo | Siempre la del servidor | Evita skew y manipulación; los lotes se vacían en ≤ 2 s |
| Origen (`source`) | `web` \| `app` \| `api` \| `server` | Distingue visitas web/app; `server` para hechos observados en servidor |
| Retención | 90 días eventos de alto volumen, 365 el resto | Mantiene la tabla acotada en D1 (límite 10 GB) |
| Borrado de workspace | Se borran sus eventos | No son registro legal (a diferencia de `audit_logs`) |

**Supuestos tomados en ausencia de respuesta (confirmar en la revisión):**

1. *"Todos los eventos tendrán usuario asignado"* se interpreta como **"ningún evento anónimo/público"**. Los hechos generados por el sistema (run programado que termina, incidente que se abre por un check, webhook de Paddle) se registran con `user_id = NULL` y `workspace_id` informado; así "última ejecución" de un workspace incluye las programadas. Si se prefiere excluirlos, basta con no emitir los tipos marcados como `sistema` en §5.
2. Retención 90/365 días. Cambiarla es una constante.
3. La app móvil es solo iOS hoy; el `source` se llama `app` (no `ios`) y la plataforma va en `properties.platform` para no renombrar si llega Android.
4. No se registra `forgot-password` (ocurre en superficie pública y el usuario puede no existir).
5. Las visitas a páginas autenticadas fuera del shell de workspace (`/onboarding/workspace`, `/complimentary`, `/w/:wsId/setup/billing`) **sí** se registran: hay usuario autenticado. **Excepción decidida en implementación:** las cuentas con email sin verificar no emiten nada (ni `/verify-pending`): la API exige `requireVerifiedEmail` para que una cuenta recién registrada con un email falso no pueda escribir, y los clientes no encolan eventos hasta que `user.emailVerified` es true.

## 3. Arquitectura

```
apps/frontend (SPA)  ──(lote de visitas, keepalive)──▶  POST /api/me/events ──┐
apps/app (iOS)       ──(lote de visitas + app.opened)─▶  POST /api/me/events ──┤
                                                                               ▼
apps/api use cases ──▶ WriteAudit ──puente──▶ TrackEvent ──▶ D1 activity_events
apps/api use cases ──(puntos explícitos: auth, runs, incidentes, alertas)──▶ TrackEvent
                                                                               ▲
apps/admin (solo SELECT) ── users / workspaces / feed de actividad ────────────┘
cron 03:00 ── PurgeExpired ── borra por antigüedad y clase de volumen ─────────┘
```

Piezas nuevas en `apps/api`, siguiendo la arquitectura limpia del repo:

| Capa | Fichero | Responsabilidad |
| --- | --- | --- |
| domain | `src/domain/activity/types.ts` | `ActivityEvent`, `ActivitySource` |
| domain | `src/domain/activity/catalog.ts` | `ACTIVITY_EVENTS` (tipos), metadatos por tipo, `AUDIT_TO_ACTIVITY` |
| domain | `src/domain/activity/repo.ts` | `ActivityEventRepo` |
| application | `src/application/activity/track_event.ts` | `TrackEvent`: sanea, completa, **nunca lanza** |
| application | `src/application/activity/ingest_client_events.ts` | `IngestClientEvents`: allowlist, membresía, lote |
| application | `src/application/activity/activity_wiring.test.ts` | Fuerza que cada punto explícito emite su tipo |
| infrastructure | `src/infrastructure/db/activity_event_repo.ts` | `D1ActivityEventRepo` |
| http | `src/http/routes/activity.ts` | `POST /api/me/events` |
| migrations | `migrations/0038_activity_events.sql` | Tabla e índices |

## 4. Modelo de datos

```sql
-- migrations/0038_activity_events.sql
CREATE TABLE activity_events (
  id              TEXT PRIMARY KEY,               -- act_<ulid>
  type            TEXT NOT NULL,                  -- p. ej. 'browser_test.created'
  user_id         TEXT,                           -- actor; NULL solo en hechos del sistema
  workspace_id    TEXT,                           -- NULL en eventos de ámbito usuario (auth)
  source          TEXT NOT NULL CHECK (source IN ('web','app','api','server')),
  resource_type   TEXT,                           -- 'browser_test' | 'run' | 'uptime_monitor' | ...
  resource_id     TEXT,
  properties_json TEXT,                           -- saneado, ≤ 2000 chars
  occurred_at     INTEGER NOT NULL                -- epoch ms, reloj del servidor
);
CREATE INDEX idx_activity_ws_time      ON activity_events (workspace_id, occurred_at DESC);
CREATE INDEX idx_activity_ws_type_time ON activity_events (workspace_id, type, occurred_at DESC);
CREATE INDEX idx_activity_user_time    ON activity_events (user_id, occurred_at DESC);
CREATE INDEX idx_activity_time         ON activity_events (occurred_at DESC);
-- Añadidos tras medir con EXPLAIN QUERY PLAN las consultas del admin:
CREATE INDEX idx_activity_user_type_time ON activity_events (user_id, type, occurred_at DESC); -- último login por usuario
CREATE INDEX idx_activity_type_time      ON activity_events (type, occurred_at DESC);          -- feed filtrado por tipo y purga
CREATE INDEX idx_activity_ws_source_time ON activity_events (workspace_id, source, occurred_at DESC); -- última visita web/app
```

Fichero real: `migrations/0038_activity_events.sql` (el número 0037 lo ocupó otra migración el mismo día).

Por qué estos índices y no otros:

- `ws_time`: "última actividad del workspace", feed por workspace.
- `ws_type_time`: "última vez que el workspace hizo X" = un seek (`MAX(occurred_at)` con `type = ?`; `type IN (...)` hace un probe por valor).
- `user_time`: "última actividad / último login del usuario".
- `time`: feed global del admin y purga por antigüedad (precedente: `0024_admin_time_indexes.sql`, añadido porque el admin hace barridos por tiempo).

Convenciones que se respetan: snake_case, `*_at` en epoch ms, prefijo de id nuevo `activity: "act"` en `shared/ids.ts`.

No hay `created_at` separado: como el servidor sella el tiempo, `occurred_at` es el único instante.

### Tipos TypeScript

```ts
// domain/activity/types.ts
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

// domain/activity/repo.ts
export interface ActivityEventRepo {
  insert(event: ActivityEvent): Promise<void>;
  insertMany(events: ActivityEvent[]): Promise<void>;           // D1 batch
  deleteOlderThan(before: number, types: ActivityEventType[], limit: number): Promise<number>;
  listRecent(limit: number): Promise<ActivityEvent[]>;          // solo tests / depuración
}
```

## 5. Catálogo de eventos

### Reglas de nombre

`<sujeto>.<verbo_en_pasado>` en snake_case, sujeto en singular (`browser_test.created`, `user.logged_in`). Es la misma familia que `AUDIT_ACTIONS` (`test.created`) pero con sujetos completos, que es lo que pidió Marcos (`browser-test-*`). El catálogo es la **única** fuente de verdad: los clientes envían strings y el servidor rechaza lo que no está en él.

Cada tipo declara en `catalog.ts`:

```ts
interface ActivityEventSpec {
  scope: "user" | "workspace" | "any"; // workspace ⇒ workspace_id obligatorio; any ⇒ opcional
  resourceType: string | null;         // el servidor rellena resource_type si llega resourceId; el cliente solo manda resourceId
  client: boolean;                     // true ⇒ un cliente puede enviarlo; false ⇒ solo servidor
  volume: "high" | "normal";           // high ⇒ retención 90 d; normal ⇒ 365 d
}
```

### Tabla completa

Columna **Origen**: `cliente` (lo envía la SPA/app), `audit` (puente desde `WriteAudit`, sin tocar el use case), `explícito` (nueva llamada `track.execute` en el use case indicado), `sistema` (explícito y sin actor humano).

| Tipo | Ámbito | resource_type | Origen | Actor | Notas / properties |
| --- | --- | --- | --- | --- | --- |
| `user.registered` | user | — | explícito `auth/register.ts` | el nuevo usuario | `source` web/app según cabecera |
| `user.email_verified` | user | — | explícito `auth/verify_email.ts` | usuario | |
| `user.logged_in` | user | — | explícito `auth/login.ts` | usuario | `source` web/app |
| `user.logged_out` | user | — | explícito `auth/logout.ts` | usuario del refresh token | solo si había token |
| `user.password_reset` | user | — | audit `authPasswordReset` | usuario | |
| `web.page_viewed` | any | — | cliente (web) | usuario | `{ page }` patrón de ruta; `workspace_id` si está en `/w/:wsId` |
| `app.screen_viewed` | any | — | cliente (app) | usuario | `{ screen, appVersion, platform }` |
| `app.opened` | user | — | cliente (app) | usuario | arranque en frío y vuelta a foreground |
| `browser_test.viewed` | ws | `browser_test` | cliente | usuario | detalle y edición; `{ page \| screen }` |
| `run.viewed` | ws | `run` | cliente | usuario | |
| `uptime_monitor.viewed` | ws | `uptime_monitor` | cliente | usuario | detalle y edición |
| `incident.viewed` | ws | `incident` | cliente | usuario | |
| `workspace.created` / `.updated` / `.deleted` / `.ownership_transferred` | ws | `workspace` | audit | usuario | |
| `member.invited` / `.invitation_revoked` / `.joined` / `.role_changed` / `.removed` | ws | `member` | audit | usuario | `member.joined` = aceptar invitación |
| `browser_test.created` / `.updated` / `.deleted` | ws | `browser_test` | audit (`testCreated`…) | usuario | `{ name }` viene del metadata de audit |
| `browser_test.run_requested` | ws | `browser_test` | audit `testRunManual` | usuario | "Run now" |
| `browser_test.validated` | ws | — | explícito `browser_tests/validate_draft.ts` | usuario | "Test it" antes de guardar |
| `browser_test.imported` | ws | — | explícito `browser_tests/import_tests.ts` | usuario | `{ count }` |
| `browser_test.exported` | ws | — | explícito en handler de `/browser-tests/export` (no hay use case) | usuario | `{ count }` |
| `browser_test.run_passed` / `.run_failed` / `.run_timed_out` / `.run_errored` | ws | `browser_test` (NULL en runs de validación) | sistema: `execution/attempt_lifecycle.ts#resumeRunFinalization` | `run.triggeredByUserId` (NULL si programado) | `{ runId, runSource: MANUAL\|SCHEDULED\|VALIDATION, attemptCount, durationMs, retried }` (`retried` = `passedAfterRetry`; la clave no puede contener "pass" porque `sanitizeAuditMetadata` la redactaría). Mapeo: PASSED→passed, FAILED→failed, TIMEOUT→timed_out, SYSTEM_ERROR→errored. Las cancelaciones por borrado del test o del workspace (`handleFinalized: false`) no emiten nada |
| `report.downloaded` | ws | `run` | explícito `browser_tests/download_report.ts` | usuario | |
| `uptime_monitor.created` / `.updated` / `.deleted` | ws | `uptime_monitor` | audit (`monitor*`) | usuario | |
| `uptime_monitor.tested` | ws | — | explícito `uptime/test_request.ts` | usuario | "Test request" |
| `incident.opened` / `incident.resolved` | ws | `incident` | sistema: `incidents/handle_run_finalized.ts` y `uptime/handle_check_message.ts` | NULL | `{ kind: BROWSER_TEST\|UPTIME_MONITOR, browserTestId?, uptimeMonitorId? }` |
| `channel.created` / `.updated` / `.deleted` / `.tested` | ws | `channel` | audit | usuario | `{ type }` del metadata |
| `alert.sent` / `alert.failed` | ws | `notification_delivery` | sistema: `channels/send_queued_notification.ts` | NULL | `{ channelId, channelType, incidentId }` |
| `alerts.settings_updated` | ws | — | audit | usuario | |
| `alerts.topup_started` | ws | — | explícito `alerts/start_credit_topup.ts` | usuario | |
| `alerts.credit_topup` / `alerts.credit_adjusted` | ws | — | audit (webhook Paddle) | NULL | |
| `secret.created` / `.updated` / `.deleted` | ws | `secret` | audit | usuario | solo nombre, nunca valor |
| `security.encryption_rotated` | ws | — | audit | usuario | |
| `api_key.created` / `.revoked` | ws | `api_key` | audit | usuario | |
| `api_key.used` | ws | `api_key` | explícito en `public_api.ts` (middleware `recordUse`) | NULL (`source = api`) | **throttle**: solo si `lastUsedAt` es NULL o > 15 min; el valor previo al `touchLastUsed` ya está en el contexto |
| `billing.checkout_started` | ws | — | explícito `billing/paddle_checkout_intent.ts` | usuario | |
| `billing.subscription_updated` / `billing.grant_issued` / `billing.grant_redeemed` | ws | — | audit | usuario o NULL (webhook) | |
| `push_device.registered` | user | `push_device` | explícito `push/register_push_device.ts` | usuario | `{ platform }`; solo cuando el token no existía (la app re-registra en cada arranque) |

Volumen `high` (retención 90 d): `web.page_viewed`, `app.screen_viewed`, `app.opened`, `*.viewed`, `api_key.used`, `alert.sent`, `alert.failed`, `browser_test.run_*`. El resto `normal` (365 d).

Descartados a propósito:

- `user.session_refreshed`: el refresh proactivo de la SPA se dispara cada ~29 min aunque la pestaña esté inactiva, así que inflaría "última actividad". Las visitas son la señal buena.
- Checks de uptime individuales (uno por minuto por monitor): demasiado volumen y ya existen `incident.opened/resolved` como transiciones.
- Lecturas vía API (listados, SSE, artefactos, heartbeats de runner).

### Mapeo audit → actividad

`AUDIT_TO_ACTIVITY: Record<AuditAction, ActivityEventType>` en `catalog.ts`, declarado con `satisfies` para que añadir una acción de audit sin su evento sea un error de compilación. El test de catálogo comprueba además que ningún tipo `client: true` aparece en el mapeo (un cliente no puede falsificar `browser_test.created`).

## 6. Emisión en servidor

### 6.1 `TrackEvent` (application/activity/track_event.ts)

Mismo contrato que `WriteAudit`: recibe `{ type, userId, workspaceId?, source, resourceId?, properties? }`, rellena `resourceType` desde el catálogo cuando llega `resourceId` (un run de validación no tiene test: ambas columnas quedan NULL), sanea `properties` con `sanitizeAuditMetadata` + `truncate(…, 2000)` (mismos helpers de `shared/redact.ts`), genera `id` con `ids.newId("act")`, sella `occurredAt = clock.now()` y hace `repo.insert`. **Nunca lanza**: cualquier fallo se traduce en `logEvent("activity_write_failed", { type })`. Viola el catálogo (tipo desconocido, `scope: "workspace"` sin `workspaceId`) ⇒ también se registra y se descarta; nunca rompe el use case que lo llamó.

### 6.2 Puente desde `WriteAudit`

`WriteAudit` gana una dependencia opcional `activity?: Pick<TrackEvent, "execute">`. Tras insertar la entrada de audit:

```ts
await this.dependencies.activity?.execute({
  type: AUDIT_TO_ACTIVITY[input.action],
  userId: input.actorUserId,
  workspaceId: input.workspaceId,
  source: "server",
  resourceId: input.resourceId,
  properties: input.metadata,     // ya saneado por WriteAudit
});
```

La `ip` del audit **no** se copia. Coste: un segundo write de D1 por mutación (las mutaciones son de bajo volumen). Un fallo en el evento de actividad nunca afecta al audit (TrackEvent no lanza). Los 33 use cases auditados quedan intactos; `audit_wiring.test.ts` sigue siendo la garantía de que cada mutación pasa por `audit.execute`.

### 6.3 Puntos explícitos

Solo para hechos que hoy no están auditados (tabla §5, columna "explícito"/"sistema"). Cada use case recibe `track: Pick<TrackEvent, "execute">` por constructor, igual que hoy recibe `audit`. `activity_wiring.test.ts` replica el patrón de `audit_wiring.test.ts`: para cada tipo explícito, el fichero del use case debe contener `ACTIVITY_EVENTS.<clave>` y `track.execute`.

Detalles que importan:

- **Auth** (`Register`, `VerifyEmail`, `Login`, `Logout`): el `execute` gana `client: "web" | "app"`, que la ruta obtiene de `isNativeClient(context)` (`routes/auth.ts`). Así los eventos de auth distinguen origen sin contexto implícito. `user.registered` solo se emite cuando se crea un usuario de verdad: si el email ya existía, `Register` no crea nada (anti-enumeración) y no hay evento.
- **Runs terminales** (`resumeRunFinalization`): emitir justo antes de `durable.completeJob`. Si el Worker muere entre el evento y `completeJob`, la reanudación duplicará el evento: aceptable (analítica, no facturación) y documentado.
- **Incidentes**: cuatro puntos (abrir/resolver × run/check). `incident.opened` se emite al insertar el incidente y `incident.resolved` al resolverlo, con `kind` en properties.
- **Alertas**: `alert.sent` tras `finishDispatch(..., "SENT")`; `alert.failed` en la rama terminal de fallo. Son `source = "server"`, `user_id = NULL`.
- **`api_key.used`**: en el middleware `recordUse` de `public_api.ts` (es donde vive el estado del throttle), `source = "api"`, `workspace_id` del API key, `user_id = NULL`, `properties = { keyId }`.

### 6.4 `source` en eventos de servidor

No se enhebra `source` por los 33 use cases auditados (supondría tocar 33 rutas + 30 inputs para un dato secundario) ni se introduce `AsyncLocalStorage` (contexto implícito, ajeno al estilo de DI explícita del repo). Regla: `source` describe **cómo entró el evento**: `web`/`app` para lo que reportan los clientes y para auth (donde es barato saberlo), `api` para API pública, `server` para todo lo observado en use cases o jobs. "Última visita web" se responde con `source = 'web'`; "última actividad" con `user_id IS NOT NULL`.

## 7. Ingesta de eventos de cliente — `POST /api/me/events`

Montado bajo `/api/me` junto a `push-devices` (recurso de ámbito usuario). Middleware: `requireAuth` + `requireVerifiedEmail` (decisión de implementación: una cuenta sin verificar no escribe; los clientes tampoco envían hasta verificar). Rate limit con el `D1RateLimiter` existente, en **lotes** (los clientes vacían un lote por navegación): `RATE_LIMITS.events = { limit: 120, windowSeconds: 60 }` por usuario y por IP, `events_daily = { limit: 5_000, windowSeconds: 86_400 }` por usuario y por IP, y un cortacircuitos global `events_global_daily = { limit: 50_000, windowSeconds: 86_400 }` (~2,5× el volumen diario esperado con 100 usuarios activos; subir cuando crezca el producto). Además, un lote no puede mezclar más de 5 workspaces.

```jsonc
// request
{ "events": [
  { "type": "browser_test.viewed", "workspaceId": "ws_…", "resourceId": "bt_…", "properties": { "page": "/w/:wsId/tests/:testId" } },
  { "type": "web.page_viewed",     "workspaceId": "ws_…", "properties": { "page": "/w/:wsId/alerts" } }
]}
// response 202
{ "data": { "accepted": 2, "dropped": 0 } }
```

Validación zod: 1–25 eventos; `type` string ≤ 64; `workspaceId`/`resourceId` strings ≤ 64; `properties` objeto de ≤ 20 claves con valores string (≤ 200), number o boolean. Lo que excede ⇒ 400 (bug de cliente).

`IngestClientEvents.execute({ user, source, events })`:

1. `source` lo fija la ruta: `app` si `X-Zenguy-Client: native`, si no `web`.
2. Descarta (sin error, contando en `dropped`) cualquier evento cuyo `type` no exista o no sea `client: true`, o cuyo ámbito no cuadre (`scope: "workspace"` sin `workspaceId`).
3. Comprueba membresía por cada `workspaceId` distinto del lote (`MemberRepo.find`, memoizado en la llamada). No miembro ⇒ descartado en silencio, indistinguible de un workspace inexistente (misma política que `withWorkspace`).
4. Construye las filas con `occurredAt = clock.now()` y hace un único `insertMany` (D1 `batch`).

No se verifica que `resourceId` pertenezca al workspace: un cliente malicioso solo puede ensuciar la analítica de su propio workspace, nunca leer ni escribir datos ajenos. Se documenta y se acepta.

No hay idempotencia por evento: un reintento de red podría duplicar visitas. Se acepta (no es facturación) y se minimiza con el cliente (§8.3: sin reintentos).

Se añade la ruta a `rbac_matrix.itest.ts` y `cross_tenant.itest.ts` como el resto de endpoints.

## 8. Webapp (`apps/frontend`)

Hoy no existe ninguna telemetría ni patrón fire-and-forget. Se añade lo mínimo, siguiendo la convención del repo de "helper puro exportado + componente fino".

### 8.1 Mapeo ruta → evento (`src/lib/activity/route-events.ts`)

Lista `ROUTE_EVENTS` con todos los paths autenticados de `App.tsx` (incluidos los de fuera del shell) evaluada con `matchPath` de react-router v7. Devuelve `visitEventFor(pathname): ClientEvent | null`:

| Patrón | Tipo | resourceId |
| --- | --- | --- |
| `/w/:wsId/tests/:testId`, `…/edit` | `browser_test.viewed` | `testId` |
| `/w/:wsId/runs/:runId` | `run.viewed` | `runId` |
| `/w/:wsId/uptime/:monitorId`, `…/edit` | `uptime_monitor.viewed` | `monitorId` |
| `/w/:wsId/incidents/:incidentId` | `incident.viewed` | `incidentId` |
| resto de rutas autenticadas | `web.page_viewed` | — |
| rutas públicas / desconocidas | `null` (no se emite) | |

`properties.page` lleva siempre el **patrón** (`/w/:wsId/tests/:testId`), nunca el path concreto ni la query string: los ids van en `workspaceId`/`resourceId`. Un test unitario comprueba que cada path de la lista produce un evento; añadir una página nueva implica añadir su fila (se deja comentario en `App.tsx`).

### 8.2 Dónde se engancha

Un componente `<ActivityTracker />` renderizado dentro de `RequireAuth` (`App.tsx:72`), que cubre tanto el shell `/w/:wsId` como las páginas autenticadas sueltas. Usa `useLocation()` y `useAuth()`; el `wsId` sale de los params del patrón, **no** de `useWorkspace()` (que lanza fuera de su provider). Solo emite con `status === "signedIn"` y `user.emailVerified`. Las redirecciones puras (`/w/:wsId` índice, `/notifications`) no tienen fila en `ROUTE_EVENTS`.

### 8.3 Cola y transporte (`src/lib/activity/queue.ts`, `src/lib/api.ts`)

`createActivityQueue({ send, now })` (transporte inyectado, como `createEventSource` en `sse.ts`):

- dedupe: misma (type, page, resourceId) en los últimos 30 s ⇒ se ignora (React StrictMode, re-renders, volver atrás);
- flush por debounce de 1 s o al llegar a 25 eventos;
- flush inmediato en `visibilitychange → hidden` y `pagehide`;
- `clear()` al cerrar sesión (`status` pasa a `signedOut`) para no enviar visitas del usuario anterior con el token del siguiente;
- sin reintentos: si falla, se descarta.

Transporte: `apiBeacon(path, body)` nuevo en `api.ts`: mismo `request()` (cabecera `Authorization`, refresh, invariante `/api/`), con `keepalive: true`, sin reintento en 401 y tragándose cualquier error (incluido `SessionSupersededError`). `navigator.sendBeacon` se descarta porque no admite cabecera `Authorization`.

## 9. App iOS (`apps/app`)

### 9.1 Mapeo pantalla → evento (`src/lib/activity/screen-events.ts`)

`useSegments()` da el patrón sin ids (`["w","[wsId]","(tabs)","(tests)","tests","[testId]"]`) y `useGlobalSearchParams()` los params. `visitEventFor(segments, params)` elimina los grupos `(…)` y construye `screen = "/w/[wsId]/tests/[testId]"`, con el mismo mapeo de tipos que la web (`browser_test.viewed`, `run.viewed`, `uptime_monitor.viewed`, `incident.viewed`, resto `app.screen_viewed`). Pantallas públicas (`(auth)/*`, `privacy`, `terms`, `verify-email`, `invitations/[token]`) ⇒ `null`.

`properties`: `{ screen, appVersion, platform: "ios" }` (`appVersion` de `src/lib/app-version.ts`).

### 9.2 Dónde se engancha

`<ActivityTracker />` en `src/components/ActivityTracker.tsx`, hermano de `<UpdateGate />` en `ProtectedAppContent` (`app/_layout.tsx:99`): está dentro de Auth/Push/AppLock y del contenedor de navegación. Solo emite con `status === "signedIn"` y `user.emailVerified`. `app.opened` se emite en el arranque en frío (una vez por proceso) y en cada vuelta a foreground; antes del sign-out se vacía la cola y se espera la entrega (el sign-out aborta las peticiones en vuelo).

`AppState` (ya observado en cuatro sitios): transición a `active` ⇒ `app.opened`; transición a `background` ⇒ flush. Con la app bloqueada (AppLock) el navegador sigue montado pero el path no cambia, así que no se generan visitas fantasma; `app.opened` sí se emite aunque esté bloqueada (abrir la app es actividad).

### 9.3 Cola y transporte

Misma cola que la web, copiada (las apps son raíces pnpm independientes, como ya ocurre con `api.ts`). Transporte: `src/api/events.ts` → `apiPost("/api/me/events", …)` envuelto en `void ….catch(() => undefined)` (patrón de la casa). Flush y `clear()` en `onBeforeSignOut` (`src/lib/session-hooks.ts`) y `authEvents.onSignedOut`. Sin cola persistente: sin red se pierde.

Es un cambio solo JS ⇒ se publica como OTA (EAS Update), sin binario nuevo.

## 10. Panel admin (`apps/admin`)

El admin no toca `apps/api`; lee `activity_events` con SELECTs explícitos, y degrada con el idioma existente (`MIGRATION_PENDING` si la tabla aún no existe en producción).

### 10.1 Usuarios (`db/users.ts`, `UsersTable`)

*Estado:* pendiente. El cliente del admin está siendo reescrito en la rama `admin-v2` por otra sesión, que montará las secciones nuevas y este cambio de `last_active_at`; en esta entrega el admin solo gana los loaders y rutas de servidor (§10.2, §10.3).

`last_active_at` pasa a ser:

```sql
COALESCE(
  (SELECT MAX(e.occurred_at) FROM activity_events e WHERE e.user_id = users.id),
  (SELECT MAX(t.created_at)  FROM refresh_tokens  t WHERE t.user_id = users.id)
)
```

El fallback a `refresh_tokens` solo actúa para usuarios sin ningún evento todavía (tras el despliegue) y desaparece solo cuando el usuario hace algo. Se añade `last_login_at` (`type = 'user.logged_in'`) y la columna **Last login** en la tabla; el contrato `UserSummary` crece, no cambia.

### 10.2 Workspaces (nuevo: `db/workspaces.ts`, `GET /api/workspaces?limit=`, `WorkspacesTable`)

Hoy no hay listado de workspaces; aquí es donde viven las preguntas "última vez que el workspace hizo X":

| Columna | Fuente |
| --- | --- |
| Workspace (nombre, slug, owner) | `workspaces` + `users` |
| Members | `COUNT(*)` de `workspace_members` |
| Last active | `MAX(occurred_at)` con `user_id IS NOT NULL` |
| Last web / Last app | `MAX(occurred_at)` con `source = 'web'` / `'app'` |
| Last test created | `type = 'browser_test.created'` |
| Last run (+ estado) | `type IN ('browser_test.run_passed','…failed','…timed_out','…errored')`, estado = tipo de la fila más reciente |
| Last alert sent | `type = 'alert.sent'` |
| Created | `workspaces.created_at` |

Orden: `last_active_at DESC NULLS LAST`. Cada subconsulta es un seek sobre `idx_activity_ws_type_time`/`idx_activity_ws_time`. Polling 60 s como `users`.

### 10.3 Feed de actividad (nuevo: `db/activity.ts`, `GET /api/activity?limit=&type=`, `ActivityFeed`)

Últimos N eventos (por defecto 50, máx. 200) con JOIN a `users` (nombre/email) y `workspaces` (nombre): **Time · Type · Actor · Workspace · Resource · Source**. Filtro opcional por `type` (validado contra una lista blanca copiada del catálogo; el admin no importa código de la API). Polling 15 s. Es la "vista en vivo" de lo que pasa en la plataforma.

### 10.4 Tests admin

`queries.itest.ts` añade `activity_events` a `TABLES`; itests de cada loader con datos sembrados y `NOW` fijo; `routes/data.test.ts` extiende `PATHS` con las rutas nuevas; `sections.test.tsx` cubre `WorkspacesTable` y `ActivityFeed` (render a string, como el resto); test de degradación con `DROP TABLE activity_events`.

## 11. Retención y borrado

- **Cron diario (`0 3 * * *` → `PurgeExpired`)**: `deleteOlderThan(now − 90 d, tiposHigh, 500)` y `deleteOlderThan(now − 365 d, tiposNormal, 500)` en bucle por lotes hasta que un lote borre 0, como el resto de purgas. Las listas de tipos se derivan del catálogo (`volume`). `CleanupCounts` gana `activityEvents`.
- **Borrado de workspace** (`WorkspaceDeletionSaga` / `workspace_deletion_repo.ts`): `DELETE FROM activity_events WHERE workspace_id = ?` en el mismo batch que el resto de tablas operativas. A diferencia de `audit_logs`, no se retiene ni anonimiza: no es registro legal. Los eventos de ámbito usuario (`workspace_id IS NULL`) permanecen con el usuario.
- **Estimación de volumen**: visitas ≈ 200/usuario activo/día. Con 100 usuarios activos ⇒ 20 k filas/día ⇒ ~1,8 M filas vivas en la ventana de 90 d, < 1 GB con índices. Muy por debajo del límite de 10 GB de D1. Si el volumen se multiplicara por 10, el plan es una tabla rollup (§15), no cambiar de almacén.

## 12. Privacidad y seguridad

- Sin IPs ni user agents en `activity_events` (eso es terreno del audit). Sin query strings ni paths concretos: solo patrones de ruta; los ids van en columnas propias.
- `properties` solo admite escalares y pasa por `sanitizeAuditMetadata` (redacción de claves sensibles) y truncado a 2000 chars. Nunca valores de secrets ni tokens.
- El cliente solo puede emitir tipos `client: true`; los tipos de servidor (`user.logged_in`, `browser_test.run_passed`, …) se descartan aunque los envíe.
- Membresía verificada por workspace en cada lote; respuesta indistinguible entre "no miembro" y "no existe".
- Rate limit por usuario y límite de tamaño de lote; body cubierto por `MAX_API_REQUEST_BODY_BYTES`.
- CORS: `/api/me/events` vive bajo `spaCors`, igual que el resto de `/api/me`.
- Producción vs staging: nada nuevo; cada entorno escribe en su D1.

## 13. Testing (TDD, como el resto del repo)

**API**

- `domain/activity/catalog.test.ts`: regex de nombres; `AUDIT_TO_ACTIVITY` cubre todas las `AUDIT_ACTIONS`; ningún tipo `client: true` está en el mapeo; `scope`/`resourceType` coherentes.
- `application/activity/track_event.test.ts`: rellena `resourceType`, sanea y trunca, descarta tipo desconocido, **no lanza** cuando el repo falla (solo `logEvent`).
- `application/activity/ingest_client_events.test.ts`: descarta no miembros, tipos de servidor, ámbito incorrecto; un solo `insertMany`; cuenta `accepted/dropped`.
- `application/activity/activity_wiring.test.ts`: cada punto explícito contiene `ACTIVITY_EVENTS.<clave>` y `track.execute`.
- `application/audit/write_audit.test.ts`: el puente emite el tipo mapeado con actor/workspace/resource; un fallo del puente no rompe el audit.
- `auth/*.test.ts`, `execution/attempt_lifecycle.test.ts`, `incidents/handle_run_finalized.test.ts`, `uptime/handle_check_message.test.ts`, `channels/send_queued_notification.test.ts`: aserciones sobre el fake de `TrackEvent`.
- `infrastructure/db/activity_event_repo.itest.ts`: `insert`, `insertMany`, `deleteOlderThan` por tipos y lote, índices usados (`EXPLAIN QUERY PLAN` opcional).
- `http/routes/activity_routes.itest.ts`: 202 con contadores, 401 sin token, 429 por rate limit, 400 por lote > 25, `source` según cabecera, no miembro ⇒ `dropped`.
- `rbac_matrix.itest.ts`, `cross_tenant.itest.ts`: ruta nueva. `maintenance/purge_expired.test.ts`: dos niveles de retención. `workspace_deletion_repo.itest.ts`: eventos borrados.
- `src/test/fakes`: `FakeActivityEventRepo` (en memoria) y `fakeTrackEvent()` que acumula llamadas.

**Frontend**: `route-events.test.ts` (todos los paths autenticados mapean; públicos ⇒ null; `page` es patrón), `queue.test.ts` (dedupe, debounce, tamaño de lote, `clear`) con fake timers.

**App**: `screen-events.test.ts`, `queue.test.ts`, `ActivityTracker.test.tsx` (testing-library RN: emite en cambio de segmentos y en `AppState → active`). El flujo Maestro `smoke.yaml` ya recorre todas las pestañas: verificación manual consultando la D1 local tras ejecutarlo.

## 14. Despliegue

1. **API**: migración `0038` + código. Los eventos de servidor empiezan a fluir en cuanto se despliega; el endpoint de ingesta queda listo para los clientes. Staging primero (`push main:staging` reaplica migraciones y resiembra la D1 de staging; lo lanza Marcos).
2. **Webapp**: se despliega con la API (mismo pipeline).
3. **Admin**: despliegue manual tras la API de producción; hasta entonces las secciones nuevas muestran "migration pending".
4. **App iOS**: OTA vía EAS Update (solo JS). Las versiones antiguas simplemente no envían visitas.
5. Verificación: `wrangler d1 execute … "SELECT type, COUNT(*) FROM activity_events GROUP BY 1"` en staging tras navegar con la SPA y la app; comprobar en el admin que aparecen "Last active" y el feed.

### Fases sugeridas para el plan de implementación

Cada fase es desplegable por sí sola y deja valor:

- **Fase A — API** (`apps/api`): migración, catálogo, `TrackEvent`, puente audit, puntos explícitos, `POST /api/me/events`, retención y borrado de workspace. Desde aquí ya se responde "última vez que el workspace hizo X" con SQL.
- **Fase B — Admin** (`apps/admin`): `last_login_at`/`last_active_at` nuevos, tabla de workspaces y feed. Es lo que hace visibles las respuestas.
- **Fase C — Webapp** (`apps/frontend`): visitas web.
- **Fase D — App iOS** (`apps/app`): visitas de pantalla y `app.opened`, publicada por OTA.

Recordatorio operativo: push a `main` despliega producción; se hace solo con el OK explícito de Marcos.

## 15. Alternativas descartadas

| Alternativa | Por qué no |
| --- | --- |
| Reutilizar `audit_logs` para todo | Es registro de seguridad visible para el cliente, se anonimiza en borrado y no admite filas sin workspace; meter 20 k visitas/día ahí rompería su semántica y su listado |
| Workers Analytics Engine | Muestreo a volumen, retención 90 d fija, sin lookups indexados por workspace/usuario, y un segundo almacén que el admin tendría que consultar por otra vía. Puede complementar más adelante para gráficas agregadas |
| Columnas `last_*_at` desnormalizadas en `users`/`workspaces` | Escrituras en el hot path y una migración por cada pregunta nueva; la tabla indexada responde "última vez X" con un seek. Candidato natural a rollup si el volumen crece ×10 |
| Llamada `track.execute` explícita en los 33 use cases auditados | 33 diffs repetidos para un dato que `WriteAudit` ya tiene; el puente lo hace exhaustivo por tipos |
| Cola (Queue) para la ingesta | Un `batch` de D1 por lote tarda milisegundos; la cola añade latencia y piezas sin beneficio a este volumen |
| Timestamps de cliente | Skew y manipulación; el lote se vacía en ≤ 2 s, el error es irrelevante |
| `AsyncLocalStorage` para propagar `source` | Contexto implícito, contrario a la DI explícita del repo; el beneficio (origen en mutaciones) no justifica el precedente |
| `navigator.sendBeacon` | No admite cabecera `Authorization`; `fetch` con `keepalive` sí |

## 16. Riesgos y límites conocidos

- **Duplicados ocasionales** en `browser_test.run_*` (reanudación de job durable) y en visitas (reintento de red, StrictMode). Aceptados; el dedupe de 30 s en cliente mitiga el segundo.
- **"Last active" tras el despliegue**: usuarios sin actividad reciente muestran el fallback de `refresh_tokens` hasta que vuelven.
- **Páginas nuevas sin fila en `ROUTE_EVENTS`/`screen-events`**: no se registran. El test unitario y el comentario en `App.tsx` reducen el riesgo; no hay forma de derivarlo del router declarativo sin refactor.
- **Crecimiento de D1**: acotado por retención; vigilar `SELECT COUNT(*)` en el admin (tile opcional en overview).
- **Un write extra por mutación** (puente audit). Despreciable frente al resto del use case.

## 17. Preguntas abiertas para la revisión

1. ¿Vale la interpretación de "todos con usuario" = "nada anónimo", con `user_id NULL` para hechos del sistema? (§2, supuesto 1)
2. ¿Retención 90/365 días?
3. ¿Quieres el feed de actividad en el admin en esta fase o solo las columnas "last X"?
4. ¿Algún evento más que quieras ver en el catálogo (§5) o alguno que sobre?
