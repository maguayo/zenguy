# Zenguy — Diseño de Status Pages públicas

**Fecha:** 2026-08-29
**Estado:** aprobado en conversación (URL, comms manuales y gating decididos por Marcos); pendiente de revisión final de este documento
**Alcance:** API (`apps/api`) y webapp (`apps/frontend`). Fuera: website, landing, app iOS, panel admin, API pública `/api/v1`.

---

## 1. Objetivo

Que un workspace pueda publicar una o varias **status pages**: páginas públicas (sin autenticación) donde sus propios clientes ven el estado de los servicios que Zenguy ya vigila. Al estilo Betterstack:

- Banner global ("All systems operational" / caída).
- Lista curada de sistemas con su estado actual, barras diarias de 90 días y % de uptime.
- Incidentes recientes y activos, con updates escritos a mano por el equipo ("We're investigating…").

La selección es **opt-in estricta**: un workspace tendrá monitors/tests privados y otros públicos; solo lo añadido explícitamente a una página se publica, y siempre bajo un nombre público editable. Diferenciador frente a Betterstack: la página puede enseñar también browser tests ("Checkout flow — Operational"), no solo uptime HTTP.

### Lo que NO es

- **No es el dashboard.** El overview interno sigue igual; la status page es una vista pública, curada y sanitizada.
- **No es un CMS.** Sin HTML/markdown del usuario, sin CSS custom, sin subida de ficheros en v1. Texto plano escapado + un accent color validado.
- **No es un canal de suscripción.** Sin "subscribe to updates" por email en v1 (vector de spam y coste; F3).

### No-goals de V1

- Dominios custom del cliente (`status.acme.com`) — F3, vía Cloudflare for SaaS.
- Incidentes creados a mano y mantenimientos programados — F2. En v1 los incidentes son solo los automáticos ya existentes; lo manual son los *updates* sobre ellos.
- Logo (subida a R2), gráfica de latencia, idioma configurable, páginas con password, quitar el badge — F2/F3.
- Exposición por la API pública `/api/v1`, app iOS y panel admin.

## 2. Decisiones y supuestos

| Decisión | Elección | Motivo |
| --- | --- | --- |
| URL pública | `app.zenguy.com/status/<slug>` ("de momento", decidido por Marcos) | Sin wildcard DNS ni Advanced Certificate Manager; mover a otro host después es re-montar la ruta |
| Serving | SSR desde el worker `zenguy-api` con `hono/html` | Cero deps y cero cambios de build (tagged template con auto-escape); acceso directo a D1; cacheable en el borde |
| Historial | Derivado de `incidents` (no se purgan nunca); **sin tabla de rollups** | 90 días reales desde el día uno; publica caídas *confirmadas* (tras retries/threshold), que es lo que una empresa quiere enseñar |
| Estado público de un item | `DOWN` ⇔ incidente OPEN; si no, `OPERATIONAL`; `PENDING` si nunca se ha comprobado | Coherente con las barras (ambas cosas salen de incidentes). Un monitor con `current_status=DOWN` pero sin incidente abierto aún se muestra OPERATIONAL: solo se publican caídas confirmadas |
| Comms manuales | Updates de texto sobre incidentes existentes (crear/borrar, ADMIN+) | Decidido por Marcos ("Auto + updates manuales"). Sin esto la página informa pero la empresa no puede comunicar |
| Gating | Todos los planes, con badge "Powered by Zenguy" | Decidido por Marcos. Growth loop clásico de Betterstack/Instatus |
| Páginas por workspace | Varias (límite 5) | La tabla lo da gratis; caso real: una pública y otra para clientes enterprise |
| RBAC | Gestión ADMIN/OWNER; lectura de config y preview, cualquier miembro | Decidir qué es público es tan sensible como los secrets |
| Nombre público | `display_name` obligatorio por item | El nombre interno puede filtrar internals ("prod-db-healthz con token X") |
| Días | UTC | Sin DST; simple y estable |
| Idioma de la página | Inglés fijo en v1 | Configurable en F2 |

**Supuestos tomados (confirmar en la revisión):**

1. El slug es **global** (namespace único entre todos los workspaces), estilo Betterstack. Cambiable; al cambiarlo, el slug viejo queda libre y sin redirect.
2. Publicar/despublicar no purga la cache de borde: hasta 60 s de staleness es aceptable.
3. Los updates de incidente son **globales al incidente**, no por página: si un recurso está en dos páginas, ambas muestran el mismo update (el mensaje habla de la caída, no de la página).
4. Un update público puede **borrarse** (retractación de una comunicación errónea) pero no editarse. Crear y borrar dejan entrada en `audit_logs`.
5. La página también responde en `api.zenguy.com/status/<slug>` (ese custom domain enruta todos los paths al worker); no se bloquea, se añade `<link rel="canonical">` apuntando a `APP_URL`.

## 3. Arquitectura

```
Visitante anónimo ──GET /status/acme──▶ route worker app.zenguy.com/status/*
                                          │  (nueva route en wrangler, intercepta
                                          │   antes que el frontend, igual que /api/*)
                                          ▼
                              zenguy-api (Hono)
                                          │ 1. rate limit por IP (patrón pre-auth de public_api)
                                          │ 2. cache de borde (caches.default, TTL 60 s)
                                          │ 3. GetPublicStatusPage (D1: página + items
                                          │    + incidentes 90 d + updates + last-run/current_status
                                          │    solo para detectar PENDING)
                                          ▼
                              HTML SSR (hono/html) ó JSON

Admin del workspace ──▶ SPA app.zenguy.com /w/:wsId/status-pages (builder)
                              │ CRUD /api/workspaces/:wsId/status-pages…  (sesión)
                              │ preview: iframe same-origin a
                              ▼ GET /api/workspaces/:wsId/status-pages/:id/preview (HTML del borrador)
```

- **Routing:** wrangler añade `app.zenguy.com/status/*` (prod) y `staging-app.zenguy.com/status/*` (staging). `wrangler_config.test.ts` se actualiza. En local se accede directo al worker: `http://localhost:8790/status/<slug>`.
- Las rutas públicas se montan en `app.ts` **fuera** de todo middleware de sesión/cookies: nunca leen ni escriben cookies. El middleware CORS global existente es inocuo aquí (GET de HTML).
- **Cache:** `caches.default` con clave por URL canónica, `Cache-Control: public, max-age=60`. El HTML lleva `<meta http-equiv="refresh" content="60">` para auto-refrescarse sin JS.
- **Rate limit:** `RATE_LIMITS.status_page` por IP (hash SHA-256 del `CF-Connecting-IP`, como `pubapi:preauth`), aplicado solo en cache miss.

## 4. Modelo de datos (migración `0049_status_pages.sql`)

```sql
CREATE TABLE status_pages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  slug TEXT NOT NULL,                -- global, lowercase
  title TEXT NOT NULL,
  description TEXT,                  -- texto plano, opcional
  accent_color TEXT,                 -- '#rrggbb' validado; null = default
  theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('LIGHT','DARK','SYSTEM')),
  published_at INTEGER,              -- null = borrador → 404 público
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
  workspace_id TEXT NOT NULL,        -- redundante a propósito, para checks cross-tenant baratos
  resource_type TEXT NOT NULL CHECK (resource_type IN ('BROWSER_TEST','UPTIME_MONITOR')),
  browser_test_id TEXT,
  uptime_monitor_id TEXT,
  display_name TEXT NOT NULL,        -- lo único que se publica como nombre
  group_name TEXT,                   -- sección opcional
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_spi_page_test ON status_page_items(status_page_id, browser_test_id)
  WHERE browser_test_id IS NOT NULL;
CREATE UNIQUE INDEX idx_spi_page_monitor ON status_page_items(status_page_id, uptime_monitor_id)
  WHERE uptime_monitor_id IS NOT NULL;
CREATE INDEX idx_spi_page ON status_page_items(status_page_id, position);

CREATE TABLE incident_updates (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  message TEXT NOT NULL,             -- texto plano, máx. 2000 chars
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_incident_updates_incident ON incident_updates(incident_id, created_at DESC);
```

Constantes nuevas en `shared/constants.ts`: `MAX_STATUS_PAGES_PER_WORKSPACE = 5`, `MAX_STATUS_PAGE_ITEMS = 50`, `MAX_INCIDENT_UPDATE_LENGTH = 2000`, `STATUS_PAGE_HISTORY_DAYS = 90`, `STATUS_PAGE_RECENT_INCIDENT_DAYS = 15`, `RESERVED_STATUS_PAGE_SLUGS` (`json`, `preview`, `assets`, `api`, `app`, `admin`, `www`, `status`, `zenguy`, `docs`, `help`, `staging`).

Slug: `^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$` (3–63 chars), ni reservado ni en uso.

### Integridad con recursos

- Al borrar (soft-delete) un monitor o test, su use case borra también los `status_page_items` que lo referencian.
- Cinturón extra: el read model público filtra recursos con `deleted_at IS NOT NULL`; el builder marca items huérfanos si los hubiera.
- **Workspace deletion saga:** se añaden `status_pages`, `status_page_items` e `incident_updates` a las tablas purgadas, como el resto de tablas operacionales del workspace.
- `purge_expired` no toca nada de esto (los updates viven lo que viva el incidente/workspace).

## 5. Read model público (`GetPublicStatusPage`)

Entrada: `slug`. Salida (o `null` → 404): página publicada + items ordenados, y por item:

- **Estado:** `DOWN` si tiene incidente OPEN; si no, `PENDING` cuando nunca se ha ejecutado (monitor `current_status = 'UNKNOWN'`; test sin run terminado — una sola query agregada `MAX(finished_at) … GROUP BY browser_test_id` para todos los tests de la página); si no, `OPERATIONAL`.
- **Barras 90 días:** por cada día UTC, downtime en segundos = suma de intervalos `[opened_at, resolved_at ?? now]` de los incidentes del recurso recortados al día. Render en 3 niveles: sin downtime / < 1 h / ≥ 1 h, con la duración exacta en el `title` del elemento. Días anteriores a `created_at` del recurso se pintan como "sin datos".
- **Uptime %:** `1 − downtime_total / ventana`, con ventana `[max(created_at, now − 90 d), now]`, dos decimales.

Consultas: una para la página+items, **una** para todos los incidentes relevantes del workspace (`workspace_id = ? AND (status = 'OPEN' OR opened_at > now − 90 d)` sobre `idx_incidents_ws_time`, filtrado a los recursos de la página en memoria), una para updates de los incidentes mostrados, una para el `MAX(finished_at)` de tests. Con cache de 60 s el coste es marginal.

**Banner global:** `MAJOR_OUTAGE` si todos los items DOWN, `PARTIAL_OUTAGE` si alguno, `OPERATIONAL` si ninguno (los PENDING no cuentan como caídos).

**Incidentes visibles:** los OPEN y los resueltos en los últimos 15 días, listados cronológicamente con: el display_name del item afectado, "Downtime from … to …" (o "ongoing"), duración, y sus updates manuales (más nuevo primero). Nada más.

### Qué se publica y qué JAMÁS

Público: título/descripción de la página, display_names, estados, barras, %, banner, incidentes sanitizados como arriba, updates manuales, badge "Powered by Zenguy" (enlace a `https://zenguy.com?utm_source=status_page`).

Jamás: URLs monitorizadas, `start_url`, instructions, métodos/headers/bodies, `failure_reason`, `response_excerpt`, `incident_events` (contienen NOTIFICATION_SENT y detalle interno), ids internos de recursos (los items públicos usan ids opacos propios), emails, nada de billing. El único nombre que sale es `display_name`: el builder lo pre-rellena con el nombre interno por comodidad, pero el admin lo confirma o edita al añadir el item — el nombre interno nunca se publica sin ese paso explícito.

## 6. Rutas

### Públicas (sin sesión, sin cookies)

| Ruta | Respuesta |
| --- | --- |
| `GET /status/:slug` | HTML SSR. 404 genérico (mismo cuerpo) para slug inexistente, borrador o página borrada |
| `GET /status/:slug/json` | El read model en JSON (para widgets/embeds futuros; mismo saneado exacto) |

Cabeceras del HTML: `Cache-Control: public, max-age=60`, CSP estricta (sin JS, `style-src 'unsafe-inline'` para el accent color inline, `img-src 'self'`), `X-Robots-Tag` ausente (indexable), OG tags con título/estado, `<link rel="canonical">`.

### Autenticadas (`/api/workspaces/:wsId/status-pages`, sesión + workspace)

| Método y ruta | Rol | Acción |
| --- | --- | --- |
| `GET /` | MEMBER | Listar páginas del workspace |
| `POST /` | ADMIN | Crear (título, slug; nace en borrador) |
| `GET /:id` | MEMBER | Detalle con items |
| `PATCH /:id` | ADMIN | Título, descripción, slug, accent, theme |
| `POST /:id/publish` · `POST /:id/unpublish` | ADMIN | `published_at` |
| `DELETE /:id` | ADMIN | Soft-delete (libera el slug) |
| `POST /:id/items` | ADMIN | Añadir monitor/test (valida pertenencia al workspace y no borrado) con display_name |
| `PATCH /:id/items/:itemId` | ADMIN | display_name, group_name |
| `DELETE /:id/items/:itemId` | ADMIN | Quitar |
| `PUT /:id/items/order` | ADMIN | Lista ordenada completa de item ids (reorden atómico) |
| `GET /:id/preview` | MEMBER | El MISMO HTML SSR pero del borrador; permite framing same-origin solo aquí |
| `POST /api/workspaces/:wsId/incidents/:incidentId/updates` | ADMIN | Crear update público |
| `DELETE …/updates/:updateId` | ADMIN | Borrar update |
| `GET …/incidents/:incidentId/updates` | MEMBER | Listar (para la página interna de incidentes) |

ADMIN significa ADMIN u OWNER, con la comprobación en el use case como en el resto de la app. Errores con los códigos habituales (`SLUG_TAKEN`, `LIMIT_REACHED`, `NOT_FOUND`…).

## 7. Auditoría y activity

Nuevas `AuditAction` (y su puente `AUDIT_TO_ACTIVITY`, forzado por tipos): `status_page.created`, `status_page.updated`, `status_page.published`, `status_page.unpublished`, `status_page.deleted`, `status_page.items_changed` (alta/baja/rename/reorden, con detalle en metadata), `incident.update_posted`, `incident.update_deleted`.

## 8. Frontend (builder)

Sección nueva "Status pages" en la navegación del workspace:

- **`/w/:wsId/status-pages`** — lista: título, slug, estado (borrador/publicada), URL pública con copy, crear nueva.
- **`/w/:wsId/status-pages/:pageId`** — editor en dos columnas:
  1. **Ajustes**: título, descripción, slug (con validación en vivo y aviso de que cambiarlo rompe la URL anterior), accent color, theme.
  2. **Sistemas**: picker de monitors/tests del workspace (buscable), cada item con display_name editable (pre-rellenado con el nombre interno, pero editable antes de guardar), group_name opcional y reorden (subir/bajar; drag si el patrón ya existe en la app).
  3. **Preview**: iframe al endpoint `/api/workspaces/:wsId/status-pages/:id/preview`, recargado tras cada guardado.
  4. **Publicar/Despublicar** con confirmación y URL final visible.
- **Incidentes**: en la página de incidentes existente, sección "Public updates" por incidente — composer (solo ADMIN+, contador de 2000) + lista con borrar. Con un aviso claro: "Visible on your public status pages".
- Roles MEMBER ven todo en read-only (misma convención que el resto de la app).

## 9. Seguridad

- Escapado automático (`hono/html`); todos los campos de usuario son texto plano; `accent_color` validado `^#[0-9a-f]{6}$`.
- Rutas públicas sin cookies ni estado de sesión; sin JS en la página v1 (CSP lo refleja).
- Rate limit por IP + cache 60 s: una página viral no tumba D1.
- 404 idéntico para inexistente/borrador/borrado: no se filtra existencia de borradores.
- Validación de pertenencia workspace ↔ recurso al añadir items e incidentes al postear updates (cross-tenant itests).
- Slugs reservados para evitar colisiones con rutas propias; enumeración de slugs publicados es aceptable (son públicos por definición).
- Phishing: contenido restringido a texto plano y sin enlaces de usuario (la descripción no autohiperlinca), badge siempre presente en v1.

## 10. Testing

- **Unit:** use cases de CRUD (límites, slug, roles), `GetPublicStatusPage` (derivación de estados, clipping de incidentes a días UTC, uptime %, PENDING, recursos borrados filtrados), updates (longitud, roles).
- **Itest (patrón de rutas existente):** `status_page_routes.itest.ts`, `public_status_routes.itest.ts` (HTML y JSON: saneado — asserts de que NUNCA aparecen URLs/failure_reason en el cuerpo —, 404 uniforme, cache headers), `incident_update_routes.itest.ts`; ampliaciones de `rbac_matrix.itest.ts` y `cross_tenant.itest.ts`.
- **Config:** `wrangler_config.test.ts` cubre las routes nuevas.
- **Frontend:** tests de páginas/formularios según el patrón existente.

## 11. Fases futuras (fuera de este spec)

- **F2:** updates con estado tipo Betterstack (Investigating/Identified/Resolved), incidentes manuales y mantenimientos programados, logo en R2, gráfica de latencia (con rollups de checks entonces), idioma, shading fino de barras.
- **F3:** dominios custom (Cloudflare for SaaS), suscripciones por email, páginas con password, quitar badge en planes de pago.
