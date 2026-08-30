# Dominios custom para Status Pages

**Fecha:** 30 de agosto de 2026
**Estado:** en producción end-to-end (código, migración, infra Cloudflare, routes y wizard desplegados). Pendiente solo una prueba E2E con un dominio real.

Permite que un workspace sirva su status page pública bajo su propio dominio (`status.example.com`) con certificado TLS automático, en vez de `app.zenguy.com/status/<slug>`. Construido sobre **Cloudflare for SaaS (Custom Hostnames)**.

## Cómo funciona (end-to-end)

1. El cliente conecta su dominio en el editor de la status page (wizard Connect → DNS → Verify).
2. El API crea un **Custom Hostname** en la zona `zenguy.com` vía API de Cloudflare (`ssl: { method: "http", type: "dv", min_tls_version: "1.2" }`).
3. El cliente añade en su DNS: `CNAME status.example.com → customers.zenguy.com`.
4. `customers.zenguy.com` es un CNAME proxied hacia `customers-origin.zenguy.com` (registro `AAAA 100::` proxied, "originless") — el **fallback origin** de CF for SaaS. En cuanto el CNAME apunta, Cloudflare completa la validación DCV por HTTP automáticamente y emite el certificado. No hay origen real: el tráfico muere en el edge y lo atiende un Worker.
5. Una petición a `https://status.example.com` entra por el edge de Cloudflare, se asocia a nuestra zona como custom hostname, y la captura la route de zona `*/*` → `zenguy-api-production`.
6. En el worker, el middleware `customDomainGate` corre **antes que todo el API**: si el `Host` no es first-party, solo responde `GET/HEAD` de `/` y `/json`; busca la página por dominio (`byCustomDomain`) y la sirve con SSR. Cualquier otra ruta o método → 404.

```
status.example.com ──CNAME──▶ customers.zenguy.com ──CNAME──▶ customers-origin (AAAA 100::, proxied)
                                        │ (edge Cloudflare, cert emitido vía DCV http)
                                        ▼
                        route */*  →  zenguy-api-production
                                        │
                                        ▼
                     customDomainGate (Host ≠ first-party)
                        ├─ GET /      → HTML de la página (published + ACTIVE)
                        ├─ GET /json  → JSON público
                        └─ resto      → 404 SSR (el API nunca responde aquí)
```

## Piezas

**API (`apps/api`)**

- `migrations/0051_status_page_custom_domains.sql` — columnas `custom_domain`, `custom_hostname_id`, `custom_domain_status` (`PENDING|ACTIVE|FAILED`), `custom_domain_checked_at`, más **índice único parcial** sobre `custom_domain`.
- `src/domain/status_pages/rules.ts` — `customDomainSchema` (trim + lowercase, regex de hostname, y prohíbe `zenguy.com` y `*.zenguy.com`); `customDomainStatusFromHostname` (`active`+ssl `active` → ACTIVE; `blocked/deleted/moved/test_failed` → FAILED; resto PENDING).
- `src/infrastructure/cloudflare/custom_hostnames.ts` — cliente HTTP del API de custom hostnames (create/get/remove; `get` devuelve null en 404, `remove` tolera 404).
- `src/infrastructure/dns/doh.ts` — resolución CNAME vía DNS-over-HTTPS (`cloudflare-dns.com`) para el diagnóstico del wizard; cualquier fallo → `null`, nunca rompe el check.
- `src/application/status_pages/set_custom_domain.ts`, `check_custom_domain.ts`, `remove_custom_domain.ts` — use cases con el pipeline estándar: `can(role, "status_pages.manage")` → suscripción activa → trabajo → audit.
- `src/http/routes/status_public.ts` — `customDomainGate`, `isFirstPartyHost`, `servePublic` (cache edge 60 s + rate limit por IP).
- `src/shared/config.ts` — la feature solo se enciende si `CF_SAAS_ZONE_ID` es un id de 32 hex (un placeholder la apaga sola); sin config, los endpoints devuelven 503 `SERVICE_UNAVAILABLE` y el frontend lo explica.

**Frontend (`apps/frontend`)**

- `src/pages/status_pages/CustomDomainCard.tsx` — wizard con stepper (Choose domain → Add DNS record → Verification), tabla CNAME con botones de copiar, diagnóstico legible (CNAME encontrado/correcto, estado del certificado, errores de Cloudflare) y auto-poll cada 30 s mientras está PENDING. Members sin permiso ven una vista de solo lectura.

**Infra Cloudflare (zona `zenguy.com`)**

- Cloudflare for SaaS activado: 100 hostnames incluidos gratis, $0.10/mes por hostname adicional.
- Fallback origin `customers-origin.zenguy.com` (Active) + CNAME target `customers.zenguy.com`.
- Token API dedicado con scope mínimo: **Zone → SSL and Certificates → Edit, solo zona zenguy.com**, guardado como secret `CF_SAAS_API_TOKEN` del worker de producción.
- Vars: `CF_SAAS_ZONE_ID`, `STATUS_CNAME_TARGET=customers.zenguy.com` (en `wrangler.jsonc`).
- **8 Workers Routes**: `*/*` → `zenguy-api-production` (la que captura los dominios de clientes) + exclusiones con Worker=None para `zenguy.com/*`, `www.zenguy.com/*`, `app.zenguy.com/*`, `staging-app.zenguy.com/*` + las específicas preexistentes (`app…/api/*`, `app…/status/*`, `staging…/api/*`). `api.zenguy.com` y `admin.zenguy.com` son Custom Domains de sus workers y tienen precedencia implícita sobre `*/*`.

## Seguridad

**Lo que está cubierto:**

- **Superficie mínima bajo Host ajeno.** El gate corre antes que cualquier ruta del API: bajo un dominio de cliente solo existen `GET/HEAD /` y `/json`. Login, billing, webhooks, admin… todo responde 404. Es una superficie 100 % anónima: sin cookies ni sesiones, así que no hay nada que fijar ni robar bajo un dominio que no controlamos.
- **Nadie puede conectar un dominio nuestro.** `customDomainSchema` rechaza `zenguy.com` y cualquier subdominio. Además `isFirstPartyHost` trata todo `*.zenguy.com` como first-party, con lo que ni siquiera un bypass de validación lo serviría como dominio de cliente (defensa doble).
- **Solo se sirve lo publicado y verificado.** `byCustomDomain` exige `published = true` y `custom_domain_status = 'ACTIVE'`. Un draft o un dominio a medio verificar nunca sirve contenido. Y antes de llegar ahí, el edge rechaza con 403 cualquier hostname sin certificado emitido (verificado en producción).
- **Unicidad global del dominio.** Índice único parcial en D1; en la race de dos escritores, el perdedor recibe 409 y **se borra el custom hostname que había creado en Cloudflare** para no dejar hostnames huérfanos reclamados (`set_custom_domain.ts`).
- **Autorización y auditoría.** Conectar/verificar/quitar exige rol con `status_pages.manage` y suscripción activa; cada cambio deja entrada de audit con el dominio en metadata (visible en Activity).
- **XSS y headers.** El SSR usa `hono/html` (auto-escape): los títulos y nombres que edita el cliente no pueden inyectar HTML/JS en su propia página pública. Las respuestas llevan CSP estricta (`default-src 'none'`, solo estilos inline, `frame-ancestors 'none'`), `nosniff` y `Referrer-Policy: no-referrer`. CORS abierto solo en `/json` (es contenido público por definición).
- **Coste/DoS.** Cache de edge 60 s por URL; el rate limit (120 req/60 s por IP hasheada) solo corre en cache miss, así que una página cacheada no toca ni D1 ni el limiter.
- **Token con scope mínimo.** Un permiso, una zona, rotable desde el dash sin tocar código; nunca está en el repo (secret de Workers). Certificados emitidos con TLS mínimo 1.2.

**Riesgos residuales (asumidos, documentados):**

- **Dangling CNAME / claim ajeno.** La única prueba de "propiedad" es el propio CNAME (DCV http). Si alguien deja `status.suempresa.com → customers.zenguy.com` apuntando sin tener el dominio conectado (o lo desconecta y olvida el DNS), otro workspace podría conectarlo y serviría **su** página bajo ese dominio. Hoy el riesgo es bajo (pocos clientes, ventana pequeña), pero a escala conviene exigir un TXT de verificación por workspace (`_zenguy-verify.<dominio>` con token) antes de crear el hostname. Es la mejora de seguridad nº 1 pendiente.
- **El estado es un snapshot, no tiempo real.** `custom_domain_status` se refresca al hacer check (manual o auto-poll del wizard). Si Cloudflare degrada un hostname (`moved`, cert revocado) y nadie hace check, nuestra DB sigue en ACTIVE — aunque en la práctica el tráfico ya muere en el edge sin cert válido, así que el impacto real es una UI desactualizada, no contenido mal servido.
- **Cache de 60 s tras un takedown.** Despublicar una página o quitar un dominio puede seguir sirviendo la versión cacheada hasta 60 s en el POP que la tenga. Asumido a cambio del rendimiento.

## Tradeoffs

- **CF for SaaS vs. montar TLS propio.** Certificados, renovación y edge gratis (hasta 100 dominios) contra profundizar el lock-in en Cloudflare. Con todo el stack ya en CF, fue la decisión fácil; la alternativa (terminar TLS nosotros o pedir certs al cliente) era infra y soporte que no queremos.
- **DCV http vs. TXT de pre-verificación.** Elegimos la fricción mínima: el cliente añade **un** registro DNS y ya. El precio es el riesgo de dangling CNAME de arriba. Con más clientes, añadir el TXT (2 registros, algo más de fricción) será lo correcto.
- **Mismo worker + gate vs. worker dedicado en el wildcard.** `*/*` podría apuntar a un worker separado que solo supiera servir status pages (aislamiento total del API). Elegimos el mismo worker con `customDomainGate` delante: un solo deploy, una config, acceso D1/cache compartido. El coste es que el aislamiento depende de un middleware (bien testeado y registrado justo tras el error handler); si esto crece, extraer un worker `zenguy-status` es un refactor limpio.
- **Route wildcard de zona.** Es lo que exige worker-as-origin con custom hostnames, pero tiene un gotcha operacional permanente: **cada subdominio first-party nuevo que sirva otra cosa** (p. ej. un futuro proyecto de Pages en `x.zenguy.com`) **necesita su route de exclusión** (Worker=None) o su propio Custom Domain, o el wildcard se lo traga.
- **Poll de 30 s vs. webhooks de Cloudflare.** El wizard hace polling mientras está PENDING. CF ofrece webhooks de custom hostnames que darían verificación instantánea, pero exigen un endpoint público más, verificación de firma y otro secret. YAGNI de momento; la verificación tarda ~1-2 min igualmente por propagación DNS.
- **Solo subdominios, en la práctica.** Un apex (`example.com`) solo funciona si el DNS del cliente soporta CNAME flattening/ALIAS. No ofrecemos registros A dedicados; la UI empuja a `status.*`, que es además la convención del sector.
- **Un dominio por página.** Sin aliases múltiples ni redirects www→apex. El índice único lo refleja; añadirlo después no rompe el esquema (tabla de aliases).
- **Coste no repercutido por plan.** La feature está en todos los planes y los primeros 100 hostnames son gratis; a partir de ahí cada dominio cuesta $0.10/mes que hoy absorbemos. Si despega, habrá que gatearlo por plan o asumirlo como coste de adquisición — decisión de producto pendiente.

## Operación

- **Ver/depurar hostnames:** dash → zenguy.com → SSL/TLS → Custom Hostnames (estado del hostname y del cert). Desde el producto, el botón *Check* del wizard devuelve el diagnóstico completo (CNAME visto por DNS, estado CF, errores de verificación).
- **Cliente reporta 403:** el cert aún no está emitido (PENDING) o el CNAME no apunta. El check lo dice.
- **Añadir un subdominio first-party nuevo:** crear antes su route de exclusión o Custom Domain (ver gotcha del wildcard).
- **Rotar el token:** crear uno nuevo con el mismo scope y `npx wrangler secret put CF_SAAS_API_TOKEN --env production`.
- **E2E pendiente:** conectar un dominio real (p. ej. `status.aguayo.es` → CNAME `customers.zenguy.com`) y ver el wizard llegar a ACTIVE con la página cargando en TLS.
