# Auditoría de seguridad de ZenGuy

**Fecha:** 2026-08-23  
**Alcance:** API/Worker de Cloudflare, D1/KV/R2/Queues, runner Python con navegador, SPA web, web pública, app Expo/iOS, billing, CI/CD, configuración y dependencias.  
**Estado revisado:** árbol de trabajo local actual, incluidos los cambios no confirmados existentes.  
**Tipo de revisión:** análisis estático y de configuración, trazado de flujos de confianza, revisión de dependencias y ejecución de tests locales. No se atacaron servicios remotos ni se inspeccionaron reglas configuradas únicamente en Cloudflare, GitHub, Expo, Paddle o App Store Connect.

> **Conclusión:** no se debe considerar seguro exponer el runner actual a trabajos de usuarios no confiables. Existe una cadena explotable de máxima prioridad: credenciales conocidas de staging permiten crear ejecuciones contra páginas hostiles; el navegador corre en un Mac/VPS sin aislamiento de red suficiente; una página puede alcanzar servicios locales o privados mediante subrecursos, JavaScript, WebSocket o DNS rebinding. Antes de producción deben cerrarse al menos SEC-01, SEC-02, SEC-03, SEC-04, SEC-06, SEC-07, SEC-08 y SEC-09.

No se han copiado contraseñas, API keys ni otros valores secretos en este documento. Todo valor mencionado debe rotarse sin reutilizarlo.

## Resumen ejecutivo

| Severidad | Cantidad | Riesgo dominante |
| --- | ---: | --- |
| Crítica | 2 | Pivot desde el navegador hacia la red del runner y acceso público conocido a staging |
| Alta | 7 | Fuga de secretos, control cross-tenant del runner, fraude/coste, mezcla de identidades y CI con acceso a producción |
| Media | 17 | Bypass de controles del edge, DoS, carreras de sesión, supply chain, configuración y endurecimiento móvil/web |
| Baja | 3 | Enumeración y defensas en profundidad |

### Cadena de ataque prioritaria

1. Un atacante usa las credenciales OWNER/API key deterministas del fixture remoto de staging (SEC-02).
2. Crea un browser test apuntando a una página bajo su control; la cuota anunciada tampoco limita realmente el consumo (SEC-07).
3. La página realiza `fetch`, carga iframes/imágenes, abre WebSockets o usa DNS rebinding hacia loopback/RFC1918/metadata. Esas solicitudes no pasan por la validación de navegación del runner (SEC-01).
4. Desde el host puede atacar el modelo local, servicios de desarrollo o robar el OAuth personal de Wrangler y el bearer global del runner (SEC-04/SEC-05).
5. Esas credenciales amplían el impacto a todos los tenants, sus secretos, las colas y potencialmente la cuenta Cloudflare.

## Hallazgos críticos

### SEC-01 — Crítica — SSRF y pivot de red desde el navegador local/VPS

**Evidencia**

- `runner/browser_worker.py:856-915` valida esquema, hostname y DNS, pero esa función solo se ejecuta para la URL inicial (`:1607-1610`) y para la acción de navegación personalizada (`:1224-1237`).
- El perfil (`:1189-1208`) usa un navegador local (`is_local=True`) y `block_ip_addresses=True`, pero no configura un proxy/namespace de red ni intercepta cada request.
- La dependencia fijada en `runner/requirements.txt:1` es `browser-use[core]==0.13.8`. En la versión instalada, el `SecurityWatchdog` controla eventos de navegación/tab, bloquea IPs literales en el hostname y comprueba algunos redirects después de navegar; no cubre de forma preventiva cada iframe, imagen, `fetch`/XHR, formulario, service worker o WebSocket.
- El runner principal accede a un modelo local en loopback (`runner/browser_worker.py:63-69`) y se documenta su ejecución en el Mac del desarrollador (`runner/README.md:31-44`).

**Ataque e impacto**

Una página pública maliciosa pasa el preflight y después genera solicitudes ciegas a loopback, red privada, CGNAT o metadata. Con DNS rebinding puede resolver primero a una IP pública y después a una privada conservando el mismo origen, permitiendo lectura y exfiltración. El impacto incluye escaneo y acciones contra servicios internos, robo de credenciales del proceso/host, acceso al modelo local y toma del runner. Un `OWNER`/`ADMIN` con suscripción puede iniciar el flujo; una web legítima comprometida también puede hacerlo sin que el propietario de ZenGuy la controle.

**Corrección requerida**

- Ejecutar cada intento en una VM/microVM o contenedor efímero sin acceso al host, con usuario, filesystem y credenciales exclusivos.
- Aplicar la prohibición en la capa de red: egress proxy/firewall que resuelva y fije la IP por salto y deniegue loopback, link-local, RFC1918, CGNAT, metadata, rangos reservados e IPv6 equivalentes.
- Interceptar con CDP Fetch **toda** solicitud y redirect, incluidos subrecursos, WebSocket y service workers; revalidar DNS justo antes de conectar.
- Separar el modelo local en otra red autenticada y no ejecutar el runner en una estación de trabajo.
- Añadir pruebas adversariales de iframe, imagen, `fetch`, formulario, click, redirect, WebSocket y DNS rebinding.

### SEC-02 — Crítica por encadenamiento; alta de forma aislada — Staging remoto tiene credenciales conocidas

**Evidencia**

- El proyecto declara staging como operativo en `README.md:58-78` y publica credenciales de acceso reutilizables en `README.md:128-142` y `apps/api/README.md:67-82`.
- `apps/api/scripts/seed.mjs:7-17,829-839,872-873,883-993,1030-1040` contiene passwords fijos, usuarios ya verificados con roles OWNER/ADMIN, una suscripción activa y una API key determinista.
- `apps/api/scripts/reseed-staging.mjs:7-13,28-38` fuerza el borrado y seed remoto con `--env staging`; `apps/api/package.json:20-21` expone el comando y `apps/api/wrangler.jsonc:66-75` publica las rutas de staging.

**Ataque e impacto**

Si el seed remoto documentado ha sido ejecutado, cualquier persona con acceso al repositorio puede iniciar sesión como propietario/administrador, leer la Public API y lanzar trabajos del navegador. Staging está separado de los datos de producción, pero comparte superficie operativa, coste de proveedores y el runner físico; por ello habilita directamente SEC-01.

**Corrección requerida**

- Retirar inmediatamente staging de acceso público o protegerlo con Cloudflare Access/IP allowlist.
- Revocar la API key, passwords, access/refresh tokens y jobs existentes; rotar también el bearer del runner si staging lo ha usado.
- Separar fixtures locales y remotos. Generar credenciales aleatorias por despliegue, de corta duración, desde un secret manager; nunca versionarlas ni documentarlas.
- No conectar staging público al runner de producción ni al Mac de un desarrollador.

## Hallazgos de severidad alta

### SEC-03 — Alta — Secretos enviados por HTTP o conservados en redirects inseguros

**Evidencia**

- `apps/api/src/shared/ssrf.ts:156-170` y `apps/api/src/domain/uptime/rules.ts:29-50` permiten HTTP y HTTPS.
- `apps/api/src/application/uptime/execute_check.ts:269-337` resuelve secretos y los sustituye en URL, headers y body antes de solicitar la URL.
- En redirects (`:340-407`) solo se eliminan headers/body cuando cambia `hostname`; se conservan al cambiar de HTTPS a HTTP o al cambiar de puerto en el mismo host.
- El runner también permite HTTP (`runner/browser_worker.py:856-888`), mientras que la autorización de secretos solo liga cada valor al hostname (`:801-825` y `apps/api/src/domain/secrets/rules.ts:31-81`), no al origen HTTPS completo.

**Ataque e impacto**

Un secret de monitor puede viajar en texto claro. Un redirect `https://host` → `http://host` o hacia otro puerto del mismo host conserva `Authorization`, cookies personalizadas o body sensible y los entrega a otro servicio/origen. En browser tests ocurre el mismo problema conceptual: autorizar un hostname permite usar el valor también sobre HTTP.

**Corrección requerida**

- Prohibir sustitución de secretos fuera de HTTPS.
- Ligar `allowedDomains` a un origen exacto o a una política que incluya esquema y puertos permitidos.
- Comparar el origen completo (`scheme + host + effective port`) y eliminar credenciales/body ante cualquier cambio; no seguir redirects para requests con secretos salvo una política explícita y segura.
- Bloquear siempre los downgrades HTTPS→HTTP.

### SEC-04 — Alta — Bearer único del runner con alcance global y secretos cross-tenant

**Evidencia**

- Un único `RUNNER_API_TOKEN` se carga por entorno (`apps/api/src/shared/config.ts:14-15,48-54,71-84,107-113,229-235`) y protege todas las rutas (`apps/api/src/http/routes/runner.ts:23-40`).
- `/attempts/claim-stale` puede seleccionar un intento de cualquier tenant (`runner.ts:52-65`; `apps/api/src/application/execution/external_runner.ts:192-217`).
- La respuesta del claim contiene snapshot y secretos en claro (`external_runner.ts:52-66,162-189`). El mismo bearer puede iniciar, registrar pasos y completar/falsificar el resultado (`runner.ts:68-107`).

**Ataque e impacto**

Robar el token en el runner primario o fallback permite drenar trabajos de cualquier workspace, obtener todos los secretos referenciados, falsificar resultados/evidencias y afectar incidentes o facturación. No hay identidad criptográfica distinta por runner, job o tenant.

**Corrección requerida**

Usar mTLS o Cloudflare Access service tokens separados por runner y entorno, más capacidades de vida corta ligadas a `attemptId`, generación y `deliveryId`. Los secretos deben entregarse mediante leases de un solo uso, con scopes mínimos, rotación, revocación y auditoría de identidad.

### SEC-05 — Alta — El runner carga un OAuth personal amplio de Wrangler

**Evidencia**

- `runner/browser_worker.py:424-455` ejecuta `wrangler auth token --profile zenguy-personal` en runtime.
- `runner/README.md:31-39` confirma que se usa un perfil OAuth personal. El valor queda en memoria y se envía como bearer para consumir Queue (`browser_worker.py:279-290,503-515`).

**Ataque e impacto**

Una explotación del navegador/proceso —especialmente SEC-01— puede robar una credencial con alcance mucho mayor que leer una cola, convirtiendo el compromiso del runner en compromiso de la cuenta Cloudflare.

**Corrección requerida**

Crear API tokens dedicados y separados para staging/producción con los scopes y recursos mínimos de Queue, almacenarlos con modo `0600`/Keychain y dejar de ejecutar `wrangler auth token` desde el servicio. Rotar el OAuth actual. Referencias: [Wrangler auth](https://developers.cloudflare.com/workers/wrangler/commands/general/) y [Queue pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/).

### SEC-06 — Alta — Paddle confía en metadata de checkout controlada por el navegador

**Evidencia**

- El cliente proporciona `workspace_id` como `customData` y selecciona `priceId` (`apps/frontend/src/lib/paddle.ts:38-56,122-142`).
- El esquema de webhook no verifica items/producto/precio (`apps/api/src/application/billing/handle_paddle_webhook.ts:38-71`).
- `subscription.created` toma directamente `custom_data.workspace_id` (`:293-306`) y crea/asocia la suscripción (`:360-380`).
- `apps/api/src/infrastructure/db/subscription_repo.ts:56-84` sobrescribe la suscripción existente al colisionar por `workspace_id`.

**Ataque e impacto**

La firma de Paddle demuestra que Paddle emitió el evento, pero no que ZenGuy autorizó su asociación. Un atacante que conozca el UUID de otro workspace puede modificar el checkout, asociar su suscripción al workspace víctima y hacer que una cancelación/impago posterior afecte a la víctima. También falta verificar que el precio/producto cobrado sea exactamente el permitido.

**Corrección requerida**

Crear server-side un checkout intent opaco, de un solo uso, ligado a usuario, workspace, customer, producto, price, moneda e importe tras comprobar ownership. Consumirlo atómicamente en el webhook, validar todos los items y rechazar conflictos de customer/subscription. Como mínimo, firmar server-side la metadata y verificar esa firma.

### SEC-07 — Alta — La cuota de 300 runs no se aplica y se multiplica por workspace

**Evidencia**

- Cualquier usuario autenticado/verificado puede crear workspaces sin límite específico (`apps/api/src/http/routes/workspaces.ts:93-100`).
- Cada workspace recibe una suscripción interna `ACTIVE` (`apps/api/src/application/workspaces/create_workspace.ts:57-72`).
- Crear un run solo comprueba que la suscripción esté activa y lo encola; no reserva ni consume cuota (`apps/api/src/application/browser_tests/create_run.ts:80-110`; `billing/ensure_active_subscription.ts:8-17`).
- Los 300 runs se calculan únicamente como métrica (`billing/get_cycle_usage.ts:55-75`) y el rate limit de 10/minuto se particiona por workspace (`browser_tests/run_rate.ts:5-13`).
- La cuota se anuncia al usuario (`apps/api/src/infrastructure/email/templates.ts:140-165`).

**Ataque e impacto**

Una cuenta gratuita puede ejecutar indefinidamente y crear muchos workspaces para paralelizar el límite, consumiendo navegador, LLM y colas a cargo de la plataforma.

**Corrección requerida**

Reservar cuota de forma transaccional antes de insertar/encolar; aplicar límites mensual/diario/concurrente por cuenta y usuario además de workspace; limitar la creación de workspaces y añadir topes globales de coste/anomalías.

### SEC-08 — Alta — Cambio de identidad sin teardown filtra cache y notificaciones entre cuentas

**Evidencia**

- La SPA elimina/adopta sesión sin limpiar React Query (`apps/frontend/src/contexts/AuthContext.tsx:37-41,68-89`).
- El QueryClient es global (`apps/frontend/src/App.tsx:74-82`) y las claves no incluyen el usuario, por ejemplo `['workspaces']` (`apps/frontend/src/contexts/WorkspaceContext.tsx:65-92`). Se cachean miembros, runs/evidencias, billing y URLs privilegiadas de Paddle.
- La verificación de email puede sustituir la identidad activa directamente (`apps/frontend/src/pages/auth/VerifyEmail.tsx:50-82`; `apps/app/app/verify-email.tsx:26-74`).
- Móvil solo limpia cache al pasar por `signedOut`, no en `adoptSession` (`apps/app/src/contexts/AuthContext.tsx:42-46,77-80`).
- Push depende del booleano `eligible`, no de `user.id` (`apps/app/src/contexts/PushContext.tsx:62-73,115-132`); puede quedar registrado para A tras adoptar B y seguir mostrando alertas de A (`apps/api/src/infrastructure/notify/expo_push.ts:38-58`).

**Ataque e impacto**

En un navegador compartido, A cierra sesión y B entra sin recargar: B puede ver inmediatamente datos cacheados de A y reutilizar URLs sensibles. En iOS, un cambio A→B por verificación puede conservar cache y asociación push de A, exponiendo títulos/cuerpo de alertas en lock screen.

**Corrección requerida**

Implementar una transición atómica por `user.id`: cancelar requests, limpiar queries/mutations y `lastWorkspace`, desregistrar push con la sesión anterior, adoptar la nueva y registrar de nuevo. Incluir `user.id` en query keys sensibles y en las dependencias de `PushProvider`. Añadir pruebas A→logout→B y A→`adoptSession(B)` sin reload.

### SEC-09 — Alta — Staging y producción comparten capacidad de despliegue Cloudflare

**Evidencia**

- Staging y producción leen `secrets.CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` (`.github/workflows/staging.yml:24-35,45-50`; `.github/workflows/production.yml:37-48`).
- Ningún job declara un GitHub `environment:` que separe secretos o exija aprobación.
- Ambos workflows ejecutan Actions mediante tags mutables (`checkout@v4`, `pnpm/action-setup@v4`, `setup-node@v4`).

**Ataque e impacto**

Si el token tiene permisos de producción, un commit ejecutable desde la rama staging puede modificar el workflow, `package.json` o binarios y extraer/usar esa capacidad contra producción. El riesgo exacto depende de branch protections externas, no verificables desde el repositorio. Un takeover de un tag de Action también ejecutaría código antes de los pasos con credenciales.

**Corrección requerida**

Usar tokens distintos, mínimos y restringidos por recursos/entorno; GitHub Environments separados con aprobación para producción; proteger ramas y workflows; pinnear Actions a SHA completo y automatizar sus actualizaciones.

## Hallazgos de severidad media

### SEC-10 — Media; alta si existe origin privilegiado — `fetch()` same-zone puede saltar Worker/WAF/Access

`apps/api/src/app.ts:291-302` ejecuta monitores con `globalThis.fetch`. Las configuraciones solo habilitan `nodejs_compat` (`apps/api/wrangler.jsonc:5-8` y `apps/api/wrangler.production-bootstrap.jsonc:5-7`) y omiten `global_fetch_strictly_public`. Cloudflare documenta que, sin el flag, un fetch a la misma zona puede ir directamente al origin, ignorar Workers mapeados y omitir ajustes de seguridad del edge. Un OWNER/ADMIN puede elegir la URL del monitor y alcanzar un origin `*.zenguy.com` con controles distintos.

**Corrección:** habilitar el flag en todos los entornos/bootstrap, negar la propia zona en destinos de monitor salvo allowlist explícita, y exigir autenticación propia en cada origin. [Documentación de Cloudflare](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public).

### SEC-11 — Media — DoS por cuerpos HTTP bufferizados antes de autenticar/verificar

El webhook Paddle hace `await context.req.text()` antes de validar firma (`apps/api/src/http/routes/webhooks.ts:14-20`; verificación posterior en `billing/handle_paddle_webhook.ts:164-190`). Los parsers JSON genéricos también materializan el body antes del handler/rate limit y el import de browser tests lee todo antes de aplicar su límite de 2 MB (`http/routes/browser_tests.ts:288-303`; `domain/browser_tests/transfer.ts:68-75`). Requests muy grandes pueden agotar memoria/CPU del isolate sin credencial válida.

**Corrección:** límite global temprano por `Content-Length` más contador streaming real, caps por ruta, cancelación inmediata y rate limiting/WAF previo; para webhooks, verificar con un buffer estrictamente acotado.

### SEC-12 — Media — Auto-descarga de PDF/attachments sin cuota en el runner

`accept_downloads=False` (`runner/browser_worker.py:1189-1205`) no desactiva `auto_download_pdfs`, cuyo default en browser-use 0.13.8 es `true`. El `DownloadsWatchdog` descarga respuestas completas y las materializa en memoria; la limpieza ocurre al finalizar el intento. Una página hostil puede provocar OOM o llenar `/tmp` y tumbar el runner compartido.

**Corrección:** fijar `auto_download_pdfs=False`, desactivar/parchear el watchdog, limitar bytes en proxy/CDP y ejecutar con `MemoryMax`, cuota de disco y filesystem efímero.

### SEC-13 — Media — Rotación de refresh token no atómica

`apps/api/src/application/auth/refresh.ts:24-50` lee el token, crea primero el reemplazo y después revoca el padre. `apps/api/src/infrastructure/db/refresh_token_repo.ts:59-70` revoca sin `revoked_at IS NULL` ni comprobar filas afectadas. Dos refresh concurrentes pueden crear dos hijos válidos del mismo token robado y evitar la detección normal de reutilización.

**Corrección:** reclamar/revocar condicionalmente el padre e insertar exactamente un hijo en una transacción; el perdedor debe activar revocación de toda la familia. Añadir test de carrera.

### SEC-14 — Media — Reset de password no invalida access tokens emitidos

`apps/api/src/application/auth/reset_password.ts:44-50` cambia password y revoca refresh tokens, pero los JWT existentes siguen válidos hasta 30 minutos (`shared/constants.ts:6`; `infrastructure/auth/jwt.ts:21-52`). Un atacante conserva acceso después de que la víctima recupere la cuenta.

**Corrección:** `session_version`/`tokens_valid_after` validado en cada request e incrementado en reset y revocación global; reducir TTL o añadir `jti`/denylist para emergencia.

### SEC-15 — Media — Créditos de alertas no se reconcilian con importe ni refunds/chargebacks

El webhook de transacción no valida total neto/moneda (`apps/api/src/application/billing/handle_paddle_webhook.ts:53-71,237-265`) y solo procesa `transaction.completed`, no refunds, adjustments o chargebacks (`:204-219`), aunque el ledger contempla esos tipos (`domain/alerts/types.ts:42-47`). Un cliente puede gastar SMS/voz y después conservar créditos tras un reembolso/disputa.

**Corrección:** verificar ownership/producto/precio/moneda/neto, procesar eventos negativos idempotentes, admitir balance negativo/bloqueo durante disputa y reconciliar periódicamente contra Paddle.

### SEC-16 — Media — Rate limiting KV no es atómico y se puede sobrepasar en paralelo

`apps/api/src/shared/ratelimit.ts:21-47` hace `get` seguido de `put`; el propio comentario reconoce consistencia eventual. Muchas solicitudes concurrentes/distribuidas pueden leer el mismo contador y superar límites de login, registro, runs o proveedores de pago.

**Corrección:** Cloudflare Rate Limiting/WAF para prelimit, Durable Object/otra primitiva atómica para cuotas estrictas, y límites combinados por IP, cuenta, usuario y workspace.

### SEC-17 — Media — El deploy por defecto mezcla postura de desarrollo con recursos de producción

La raíz de `apps/api/wrangler.jsonc:16-29` apunta a D1/KV/R2 de producción, mientras `:57-64` declara `ENVIRONMENT=development`, `APP_URL=http://localhost:5173` y Paddle sandbox. No se deshabilita `workers_dev`; `apps/api/package.json:8` ofrece `wrangler deploy` sin `--env`. Un deploy accidental puede publicar otro Worker accesible con datos productivos y cookies/controles de desarrollo, si existen los secretos necesarios.

**Corrección:** eliminar bindings productivos del bloque por defecto, usar recursos locales explícitos para dev, exigir `--env`, poner `workers_dev:false` donde corresponda y añadir un guard que aborte si recursos productivos aparecen con `ENVIRONMENT != production`.

### SEC-18 — Media — Advisories conocidos y Python no reproducible

Los escáneres se ejecutaron contra los lockfiles/entorno instalados. La severidad upstream no equivale automáticamente a alcanzabilidad del producto:

| Superficie | Resultado | Alcanzabilidad observada | Acción |
| --- | --- | --- | --- |
| API/root | `extract-zip@2.0.1`, **high**, [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv), corregido en 2.0.2 | Transitivo de `@cloudflare/puppeteer`. No se encontró llamada desde el entrypoint actual ni Browser binding, por lo que no se demostró exploit en el Worker desplegado. | Actualizar/override o retirar dependencia y código muerto. |
| App Expo | `image-size@1.2.1`, dos **high**: [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) y [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | Metro/build-time; no runtime iOS. Requiere que el build procese una imagen maliciosa. | Actualizar Expo/Metro hasta `image-size >=2.0.3`. |
| App Expo | `uuid@7.0.3`, **moderate**, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Herramienta `xcode` de Expo/build-time; no se observó uso vulnerable en runtime. | Actualizar la cadena Expo hasta `uuid >=11.1.1`. |
| Runner Python | 7 advisories en `click 8.3.1`, `mcp 1.26.0`, `pip 26.1.2` y `pypdf 6.14.2` | El runner no llama `click.edit`, no publica servidor MCP, excluye `read_file` y no usa el flujo vulnerable de `pip`; no se confirmó explotación remota de esos CVEs. | Subir a `click >=8.3.3`, `mcp >=1.28.1`, `pip >=26.2`, `pypdf >=6.15.0` y volver a probar. |

`runner/requirements.txt` fija solo la dependencia directa y no hay lock transitivo ni hashes; el entorno observado contiene 114 paquetes y puede cambiar en cada instalación. Generar lock con hashes (`pip-compile --generate-hashes`/equivalente), usar `--require-hashes`, auditar en CI y construir imágenes inmutables. Los dos lockfiles pnpm sí tenían integridad SHA-512 completa y no usaban resoluciones git/HTTP/tarball.

### SEC-19 — Media — Frontends sin cabeceras declaradas y script Paddle mutable

No existe `_headers` ni otra política versionada para la SPA, website o landing; `apps/frontend/index.html:1-17` y los `wrangler.jsonc` estáticos no declaran CSP, `frame-ancestors`, HSTS, nosniff, Referrer-Policy o Permissions-Policy. Puede existir configuración externa no visible. Además `apps/frontend/src/lib/paddle.ts:75-103` carga `https://cdn.paddle.com/paddle/v2/paddle.js` mutable, con acceso al DOM y al access token en memoria.

**Corrección:** política versionada en Pages/Rules: CSP estricta, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`, allowlists mínimas de `connect/script/frame`, `Referrer-Policy: no-referrer`, nosniff, Permissions-Policy y HSTS. Usar URL/hash inmutable o SRI si Paddle lo soporta y cargar checkout solo donde se necesita.

### SEC-20 — Media — Bearer tokens en URL y deep links iOS reclamables

- Reset/verificación leen `?token=` y no limpian inmediatamente la URL (`apps/frontend/src/pages/auth/ResetPassword.tsx:29-42`; `VerifyEmail.tsx:50-82`); invitaciones/grants llevan capacidades en path (`apps/frontend/src/App.tsx:163-165`). Pueden permanecer en historial, logs de CDN/telemetría y Referer same-origin.
- iOS solo registra el esquema no verificado `zenguy` y mantiene desactivados Universal Links/AASA (`apps/app/app.config.ts:24,50-52`). Push transforma enlaces a `zenguy://` (`apps/api/src/infrastructure/notify/expo_push.ts:31-46`). Otra app puede reclamar el esquema, interceptar IDs/taps o presentar phishing; sería toma de cuenta si en el futuro se envían tokens bearer por ese canal.

**Corrección:** capturar el token en memoria y hacer `history.replaceState` de inmediato, `no-store`, `no-referrer` y redacción de logs; preferir intercambio POST. Publicar AASA, activar `associatedDomains` y emitir Universal Links HTTPS; no usar el esquema privado con secretos.

### SEC-21 — Media local — Secretos reales con permisos de lectura amplios

`apps/api/.dev.vars` está ignorado por Git, pero se observó con modo `0644` y contiene material JWT/cifrado/artifacts y credenciales de Twilio, Paddle y OpenAI. El `ENCRYPTION_KEY` local observado coincide con el ejemplo público. `TWILIO_TOKENS.md` estaba correctamente en `0600`. No se encontraron esos paths en el historial Git.

**Corrección:** `chmod 600`, comprobación de owner/symlink como la del runner (`runner/browser_worker.py:404-420`), Keychain/secret manager, separar valores local/staging/prod y rotar/re-cifrar si alguno se reutilizó fuera de desarrollo.

### SEC-22 — Media — Redirects del cliente Python pueden filtrar bearers

`runner/browser_worker.py:458-493` usa `urllib.request.urlopen` con redirects por defecto. Ese helper se invoca con tokens Cloudflare Queue (`:503-515`), runner (`:613-616,690-706`) y modelo (`:1882-1888`). Un endpoint confiable comprometido/mal configurado que responda con redirect cross-origin puede recibir `Authorization`.

**Corrección:** deshabilitar redirects o permitir únicamente mismo origen HTTPS; eliminar siempre credenciales ante cambio de esquema, host o puerto.

### SEC-23 — Media de hardening — AES-GCM global sin AAD ni rotación operativa

`apps/api/src/shared/crypto.ts:155-211` usa AES-GCM con IV aleatorio, pero sin `additionalData`. La misma key de entorno cifra secretos y configuraciones de todos los tenants (`application/secrets/resolve_secrets.ts:8-30`; `application/channels/create_channel.ts:64-73`) y solo existe versión 1. Con escritura sobre DB/backups se pueden intercambiar ciphertexts válidos entre registros; comprometer una key descifra todo el entorno.

**Corrección:** AAD con tipo, workspace, record ID y versión; DEK por tenant envuelta en KMS; key IDs, dual-read y proceso probado de rotación. No es un exploit remoto independiente sin acceso de escritura/backup.

### SEC-24 — Media — PBKDF2 de passwords por debajo del baseline actual

`apps/api/src/shared/constants.ts:11` fija PBKDF2-HMAC-SHA256 en 100.000 iteraciones y el mínimo de password es 8. Ante robo de hashes, el coste offline es menor que el baseline actual de OWASP (600.000 para PBKDF2-HMAC-SHA256 en la referencia consultada).

**Corrección:** preferir Argon2id si el runtime lo permite o elevar PBKDF2 tras medir CPU; versionar el formato y rehash-on-login, además de listas de passwords comprometidos. [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

### SEC-25 — Media de supply chain móvil — OTA sin firma y releases no reproducibles

`apps/app/app.config.ts:16-22` configura EAS Update sin certificado/metadata de code signing. Una cuenta Expo comprometida podría publicar JavaScript con acceso a la sesión/Keychain. `apps/app/eas.json:2-5` no exige commit limpio y `apps/app/README.md:222-254` usa `npx eas-cli@latest`, incluso avisando de que se suben cambios no commiteados.

**Corrección:** activar [EAS Update code signing](https://docs.expo.dev/eas-update/code-signing/), MFA y roles mínimos; fijar EAS CLI, `cli.requireCommit: true`, releases desde commits/tags aprobados y CI reproducible.

### SEC-26 — Media — App Lock no aísla accesibilidad

`apps/app/src/components/AppLockGate.tsx:23-51` dibuja un overlay absoluto como hermano del navegador (`apps/app/app/_layout.tsx:84-98`), sin semántica modal ni ocultar/desmontar el árbol subyacente. VoiceOver puede enfocar o activar controles sensibles detrás del lock visual.

**Corrección:** `accessibilityViewIsModal`, ocultar descendientes (`accessibilityElementsHidden`/`no-hide-descendants`) o desmontar contenido sensible mientras está bloqueado; probar en dispositivo con VoiceOver.

## Hallazgos de severidad baja / defensa en profundidad

### SEC-27 — Baja — Enumeración de cuentas

El registro revela explícitamente que un email ya existe (`apps/api/src/application/auth/register.ts:58-60`) y el login de un email inexistente no ejecuta el PBKDF2 dummy (`application/auth/login.ts:23-33`), generando señal de respuesta/timing. Los rate limits actuales no impiden enumeración distribuida.

**Corrección:** respuesta indistinguible, notificación por email si ya existía, hash dummy de coste equivalente y protección anti-bot en el edge.

### SEC-28 — Baja — Invariantes de auth/API no reforzadas

- Los tokens de email se leen y luego se marcan usados sin consumo condicional/transaccional (`email_token_repo.ts:50-71`; `verify_email.ts:35-47`; `reset_password.ts:32-50`). Dos requests pueden consumirlos concurrentemente.
- Los JWT no incluyen `iss`, `aud`, tipo ni `jti` (`apps/api/src/infrastructure/auth/jwt.ts:21-52`).
- Las respuestas que contienen tokens no declaran sistemáticamente `Cache-Control: no-store` (`apps/api/src/http/routes/auth.ts:168-253`).
- Las API keys no tienen scopes ni caducidad y el rate limit ocurre después de lecturas D1 (`http/routes/public_api.ts:103-158`; `application/api_keys/authenticate_api_key.ts:28-36`).
- La transferencia concurrente de ownership no tiene CAS/invariante única (`infrastructure/db/workspace_repo.ts:123-145`).
- `PAST_DUE` habilita ejecuciones sin un periodo de gracia explícito (`application/billing/ensure_active_subscription.ts:8-17`).

**Corrección:** consumos atómicos, claims y tipos explícitos, `no-store`, keys scoped/rotables/expirables, invariantes DB y política de dunning documentada.

### SEC-29 — Baja — Endurecimiento adicional del cliente

- Billing abre URLs devueltas por API sin validar esquema/host ni pedir explícitamente `noopener,noreferrer` (`apps/frontend/src/pages/billing/BillingPage.tsx:263-268,302-320`). Permitir solo HTTPS y hosts exactos de Paddle/documentos.
- Los reportes compartidos quedan en el cache iOS después de `shareAsync` (`apps/app/src/lib/share.ts:14-21`). Borrar en `finally`, usar nombres aleatorios y limpiar rezagos al iniciar.
- `NSAllowsLocalNetworking:true` se incluye también en release (`apps/app/app.config.ts:41-47`). Condicionarlo a desarrollo.
- Producción CI solo prueba la API (`.github/workflows/production.yml:28-36`) y no hay Renovate/Dependabot, OSV/audit, secret scanning o SBOM versionados. Añadir gates para todos los artefactos y fijar versiones exactas de Node/pnpm/`packageManager`.

## Plan de remediación recomendado

### P0 — Antes de aceptar otro job no confiable

1. Apagar/aislar el runner actual y ejecutar jobs en entorno efímero con bloqueo de egress (SEC-01/SEC-12).
2. Cerrar staging, rotar fixture/API key/sesiones y separar su runner (SEC-02).
3. Rotar y reducir OAuth Cloudflare y bearer del runner; capacidades por job (SEC-04/SEC-05).
4. Prohibir secretos sobre HTTP/downgrade y corregir redirects (SEC-03/SEC-22).
5. Separar tokens CI de staging/producción y proteger environments (SEC-09).

### P1 — Antes de producción pública

1. Checkout intents server-side y reconciliación completa de Paddle (SEC-06/SEC-15).
2. Enforcement transaccional de cuota y rate limiting atómico (SEC-07/SEC-16).
3. Teardown total al cambiar `user.id`, incluido push (SEC-08).
4. Activar `global_fetch_strictly_public`, body caps y guardas de deploy (SEC-10/SEC-11/SEC-17).
5. Actualizar/lockear dependencias y añadir escaneo continuo (SEC-18).

### P2 — Endurecimiento

CSP/cabeceras, Universal Links, firma OTA, KDF, AAD/rotación, App Lock accesible y los puntos SEC-19 a SEC-29.

## Controles positivos comprobados

- No se encontró IDOR/BOLA ordinario: `apps/api/src/http/middleware/workspace.ts:15-38` resuelve membership/rol en cada request y las consultas revisadas incluyen `workspace_id`.
- Invitaciones ligadas al email autenticado/verificado (`application/invitations/accept_invitation.ts:31-65`).
- Schemas Zod estrictos reducen mass assignment; no se encontraron queries SQL con input concatenado explotable.
- Refresh tokens, API keys, invitaciones y demás bearer secrets se almacenan hasheados.
- La Public API es read-only y tenant-scoped; secrets de canales aparecen enmascarados.
- Paddle valida HMAC con comparación constante, ventana temporal e idempotencia; SEC-06 se produce después, al confiar en metadata del cliente.
- CORS privado se limita al origen SPA; el wildcard está en la Public API autenticada por API key.
- El error handler no expone stacks. Artifacts/SSE validan capacidades firmadas y resuelven el run dentro del workspace.
- Slack/Discord restringen destinos a hosts HTTPS oficiales (`apps/api/src/domain/channels/types.ts:69-85`); Twilio usa endpoint fijo y errores sanitizados. No se confirmó SSRF genérico en esos canales.
- Screenshot size/base64/JPEG se valida y las keys R2 se componen con IDs server-side. Los subprocesses del runner usan argv fijo y no `shell=True`.
- No se encontraron sinks XSS explotables (`dangerouslySetInnerHTML`, `eval`, `new Function`); el `set:html` Astro observado usa un mapa constante.
- Access tokens de cliente permanecen en memoria; el refresh token móvil usa SecureStore `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- El escaneo heurístico del árbol y 170 commits no encontró credenciales comunes o claves privadas trackeadas; los secretos locales detectados están ignorados por Git.

## Validación ejecutada

| Comprobación | Resultado |
| --- | --- |
| `pnpm -r typecheck` | OK: API, frontend y website |
| `pnpm -r test` | OK: API 109 ficheros/728 tests; frontend 66 ficheros/223 tests |
| App: `tsc --noEmit` | OK |
| App: Jest | 56 suites/224 tests pasaron; Jest dejó un handle abierto y el proceso se interrumpió tras imprimir el resultado |
| Runner: `python -m unittest -v test_browser_worker.py` desde `runner/` | OK: 34 tests |
| Runner: `pip check` | OK, sin requisitos rotos |
| `pnpm audit` root | 1 high (`extract-zip`) |
| `pnpm audit` app | 2 high (`image-size`) + 1 moderate (`uuid`) |
| `pip-audit` sobre el venv | 7 advisories en 4 paquetes, con alcanzabilidad analizada en SEC-18 |

Los tests existentes no cubren las cadenas adversariales principales: subrecursos/rebinding del runner, refresh concurrente, cambio A→B sin reload, metadata Paddle manipulada, enforcement de cuota o aislamiento de CI.

## Límites de la auditoría

- No se realizaron pruebas destructivas ni explotación contra staging/producción.
- No se inspeccionaron secretos remotos, Cloudflare WAF/Access/Rules, branch protections, GitHub Environments, permisos reales de tokens, Expo roles/MFA ni configuración de Paddle/App Store.
- Un control externo puede mitigar algunos hallazgos de configuración, pero debe quedar versionado o aportarse como evidencia antes de cerrarlos.
- La revisión estática reduce, pero no elimina, la posibilidad de fallos no observados. Se recomienda pentest desde una cuenta tenant de mínimo privilegio después de corregir P0/P1.

## Referencias técnicas

- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)
- [Expo EAS Update code signing](https://docs.expo.dev/eas-update/code-signing/)
