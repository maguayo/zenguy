# Zenguy — Status Pages F3: dominios custom (`status.example.com`)

**Fecha:** 2026-08-30
**Estado:** aprobado en conversación por Marcos ("implementa la opción A y toda su interfaz"); este doc fija los detalles
**Base:** extiende `2026-08-29-status-pages-design.md` (F3). Mecanismo: **Cloudflare for SaaS (Custom Hostnames)** — verificado contra docs 30-08: disponible en plan Free, 100 hostnames incluidos, $0,10/mes por extra (hasta 50k), patrón oficial "Worker as origin".

---

## 1. Flujo del cliente

1. En el editor de su status page, el admin escribe `status.example.com` → **Connect domain**.
2. La API valida el hostname, lo registra en Cloudflare (`POST /zones/:id/custom_hostnames`, ssl method `http`, type `dv`) y guarda estado `PENDING`.
3. La UI enseña las instrucciones: *crea un CNAME `status.example.com` → `customers.zenguy.com`* (target configurable).
4. Botón **Check DNS**: (a) resolvemos el CNAME real vía DNS-over-HTTPS (1.1.1.1) para decirle si su registro apunta bien, y (b) consultamos el custom hostname en Cloudflare; cuando `status` y `ssl.status` son `active` → persistimos `ACTIVE`.
5. Con `ACTIVE` + página publicada, `https://status.example.com/` sirve el mismo SSR (y `/json` su gemela). La URL `/status/<slug>` sigue viva; el canonical pasa al dominio custom.

## 2. Decisiones

| Decisión | Elección | Motivo |
| --- | --- | --- |
| Gating por plan | Disponible para todos en v1 | Coherente con la decisión de F1; los 100 primeros hostnames son gratis. Cobrarlo queda como palanca futura de billing |
| Dominios por página | 1 (columna en `status_pages`) | YAGNI; multi-dominio = F3.1 |
| Estados persistidos | `PENDING` / `ACTIVE` / `FAILED` | El detalle fino (dns vs cert, errores) se devuelve en vivo en el check, no se persiste |
| Verificación | La de Cloudflare (DCV http automático al apuntar el CNAME) | La propiedad del dominio la prueba el DNS: sin CNAME no hay cert ni tráfico. El DoH es solo UX (diagnóstico) |
| Config del worker | `CF_SAAS_ZONE_ID` + `STATUS_CNAME_TARGET` (vars) y `CF_SAAS_API_TOKEN` (secret **opcional**, fuera de `secrets.required`) | Sin token la feature responde `SERVICE_UNAVAILABLE` y la UI lo cuenta; el preflight de deploy no se bloquea |
| Serving | Middleware temprano en `app.ts`: si el `Host` no es first-party → rama de dominio custom (solo GET `/` y `/json`; el resto 404) | Los custom hostnames llegan con su Host original; requiere la route `*/*` de zona (runbook) |
| Hosts first-party | `zenguy.com` y cualquier `*.zenguy.com`, `localhost`/`127.0.0.1` | Defensivo: jamás se sirve un subdominio propio por la rama custom |
| Borrado | Quitar dominio o borrar la página ⇒ `DELETE` del custom hostname en CF (best-effort, log si falla) | El borrado de workspace NO limpia CF (gap conocido → §6) |
| Cache/limits | Misma cache de borde (la clave ya incluye el host) y mismo rate limit por IP | Nada nuevo que razonar |

Validación de hostname (además del formato DNS): minúsculas, 4–253 chars, ≥2 labels, sin IP literal, sin puerto/protocolo/path, y **nunca** `zenguy.com` ni subdominios. Unicidad global (índice parcial). Un dominio en `PENDING` de otro workspace bloquea el mismo hostname (primer llegado); sin CNAME jamás pasará a `ACTIVE` y puede liberarse quitándolo.

## 3. Modelo de datos (migración `0051_status_page_custom_domains.sql`)

```sql
ALTER TABLE status_pages ADD COLUMN custom_domain TEXT;
ALTER TABLE status_pages ADD COLUMN custom_hostname_id TEXT;
ALTER TABLE status_pages ADD COLUMN custom_domain_status TEXT
  CHECK (custom_domain_status IN ('PENDING','ACTIVE','FAILED'));
ALTER TABLE status_pages ADD COLUMN custom_domain_checked_at INTEGER;
CREATE UNIQUE INDEX idx_status_pages_custom_domain ON status_pages(custom_domain)
  WHERE custom_domain IS NOT NULL AND deleted_at IS NULL;
```

## 4. API

| Ruta | Rol | Acción |
| --- | --- | --- |
| `PUT /api/workspaces/:wsId/status-pages/:id/custom-domain` `{hostname}` | ADMIN | Valida, crea el custom hostname en CF, persiste `PENDING`. 409 si el hostname ya está cogido; 503 si la feature no está configurada |
| `POST …/custom-domain/check` | ADMIN | DoH CNAME + `GET` a CF; actualiza estado; devuelve `{domain, status, cnameTarget, cname: {found, correct, value}, ssl, errors[]}` |
| `DELETE …/custom-domain` | ADMIN | Borra en CF (best-effort) y limpia columnas |

El detalle de la página (`GET :id`) pasa a incluir `customDomain {hostname, status}` y el read model público acepta `byCustomDomain(hostname)` (solo `ACTIVE` + publicada). Audit: `status_page.updated` con metadata `{changed: "customDomain…"}` (sin acciones nuevas).

## 5. Infraestructura — runbook para Marcos (una vez, ~20 min)

1. **Dash → zenguy.com → SSL/TLS → Custom Hostnames → Enable Cloudflare for SaaS.**
2. **DNS**: crear `customers-origin.zenguy.com` `AAAA 100::` **proxied** (registro originless).
3. **Custom Hostnames → Fallback origin** = `customers-origin.zenguy.com`; esperar estado *Active*.
4. **DNS**: crear `customers.zenguy.com` `CNAME customers-origin.zenguy.com` **proxied** (el target que copian los clientes).
5. **API token** (My Profile → API Tokens): permiso `Zone → SSL and Certificates → Edit` limitado a la zona zenguy.com → `npx wrangler secret put CF_SAAS_API_TOKEN --env production` (y staging si se quiere).
6. **Vars** ya van en wrangler.jsonc (`CF_SAAS_ZONE_ID`, `STATUS_CNAME_TARGET`) — solo falta el deploy.
7. **Routes de zona** (⚠️ el paso sensible, hacer DESPUÉS de desplegar el worker con este código): route `*/*` → `zenguy-api-production` **más exclusiones sin worker** para cada host propio (`zenguy.com/*`, `www.zenguy.com/*`, `app.zenguy.com/*`, `api.zenguy.com/*`, `admin.zenguy.com/*`, `staging-app.zenguy.com/*`, `api-staging.zenguy.com/*` y cualquier otro registro vivo del DNS — inventariar antes). Las rutas más específicas ganan, así que `/api/*` y `/status/*` siguen yendo al worker y el resto de `app.` sigue en Pages. Si falta una exclusión, ese host pasa por el worker: revisar la lista dos veces.

Hasta completar el paso 7 el código es inerte para tráfico público (los dominios custom simplemente no resuelven hacia nosotros); todo lo demás (conectar, check, estados) funciona ya contra el API de CF.

## 6. No-goals / gaps aceptados

- Borrado de workspace no limpia los custom hostnames en CF (quedan huérfanos e inactivos al retirar el DNS). F3.1: reconcile diario o efecto externo en la saga.
- Sin re-emisión manual de certs, sin certificados subidos, sin wildcards (Enterprise), sin multi-dominio por página, sin apex domains guiados (funcionan vía CNAME flattening del cliente, pero las instrucciones v1 hablan de subdominios).
- Staging queda sin feature salvo que se configuren sus vars/token.
