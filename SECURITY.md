# Auditoría de seguridad de ZenGuy

**Fecha:** 2026-08-23  
**Alcance:** API/Worker de Cloudflare, D1/KV/R2/Queues, runner Python con navegador, SPA web, web pública, app Expo/iOS, billing, CI/CD, configuración y dependencias.  
**Estado revisado:** árbol de trabajo local actual, incluidos los cambios no confirmados existentes.  
**Tipo de revisión:** siete pasadas independientes de análisis estático y de configuración, trazado de flujos de confianza, revisión de concurrencia/retención/dependencias y ejecución de tests locales. La segunda pasada incluyó expresamente el panel privilegiado `apps/admin`, carreras, colas y efectos externos; la tercera buscó regresiones en autenticación, CI/CD y supply chain; la cuarta volvió a revisar runners, rotación criptográfica, telemetría y refs privilegiadas; la quinta contrastó los controles versionados con su estado remoto efectivo; la sexta reauditó las correcciones locales y encontró una carrera adicional entre login y reset (SEC-52); la séptima revisó de nuevo Workers, respuestas de proveedores y la cadena de construcción/firma del runner, encontrando SEC-53 a SEC-58. También se inspeccionó en modo lectura el estado relevante de Cloudflare, GitHub, Expo/Paddle y los servicios del VPS; no se explotaron servicios ni se realizaron mutaciones remotas.

> **Conclusión:** no se debe considerar seguro exponer el runner desplegado a trabajos de usuarios no confiables hasta verificar su aislamiento y rotar/proteger las credenciales externas. La auditoría detectó una cadena explotable de máxima prioridad: credenciales conocidas de staging permitían crear ejecuciones contra páginas hostiles; un runner sin el aislamiento versionado puede alcanzar servicios locales o privados mediante subrecursos, JavaScript, WebSocket o DNS rebinding. Los checkboxes distinguen las correcciones ya verificadas en el árbol local de los controles remotos aún pendientes.

No se han copiado contraseñas, API keys ni otros valores secretos en este documento.

- [ ] Rotar sin reutilizar todo valor secreto mencionado.

## Resumen ejecutivo

| Severidad | Cantidad | Riesgo dominante |
| --- | ---: | --- |
| Crítica | 2 | Pivot desde el navegador hacia la red del runner y acceso público conocido a staging |
| Alta | 14 | Fuga de secretos, control cross-tenant, despliegues privilegiados, bypass del edge, escape del renderer, fraude/coste y administración global reclamable |
| Media | 37 | Bypass de controles, DoS, carreras criptográficas/sesión/invitación, colas, telemetría, CI/CD y supply chain |
| Baja | 5 | Enumeración, residuos locales y defensas en profundidad |

**Progreso:** 36 de 58 hallazgos corregidos y verificados en el árbol local; 22 continúan abiertos.

### Cadena de ataque prioritaria

1. Un atacante usa las credenciales OWNER/API key deterministas del fixture remoto de staging (SEC-02).
2. Crea un browser test apuntando a una página bajo su control; en el estado inicial la cuota anunciada tampoco limitaba realmente el consumo (SEC-07, corregido localmente).
3. Si el runner desplegado conserva la topología antigua, la página realiza `fetch`, carga iframes/imágenes, abre WebSockets o usa DNS rebinding hacia loopback/RFC1918/metadata (SEC-01).
4. Un runner antiguo o con credenciales sin rotar puede exponer el modelo local, servicios de desarrollo, OAuth personal de Wrangler o el bearer global (SEC-04/SEC-05).
5. Esas credenciales amplían el impacto a todos los tenants, sus secretos, las colas y potencialmente la cuenta Cloudflare.

## Hallazgos críticos

### SEC-01 — Crítica — SSRF y pivot de red desde el navegador local/VPS

- [ ] Corregido y verificado

**Evidencia**

- `runner/browser_worker.py:856-915` valida esquema, hostname y DNS, pero esa función solo se ejecuta para la URL inicial (`:1607-1610`) y para la acción de navegación personalizada (`:1224-1237`).
- El perfil (`:1189-1208`) usa un navegador local (`is_local=True`) y `block_ip_addresses=True`, pero no configura un proxy/namespace de red ni intercepta cada request.
- La dependencia fijada en `runner/requirements.txt:1` es `browser-use[core]==0.13.8`. En la versión instalada, el `SecurityWatchdog` controla eventos de navegación/tab, bloquea IPs literales en el hostname y comprueba algunos redirects después de navegar; no cubre de forma preventiva cada iframe, imagen, `fetch`/XHR, formulario, service worker o WebSocket.
- El runner principal accede a un modelo local en loopback (`runner/browser_worker.py:63-69`) y se documenta su ejecución en el Mac del desarrollador (`runner/README.md:31-44`).

**Ataque e impacto**

Una página pública maliciosa pasa el preflight y después genera solicitudes ciegas a loopback, red privada, CGNAT o metadata. Con DNS rebinding puede resolver primero a una IP pública y después a una privada conservando el mismo origen, permitiendo lectura y exfiltración. El impacto incluye escaneo y acciones contra servicios internos, robo de credenciales del proceso/host, acceso al modelo local y toma del runner. Un `OWNER`/`ADMIN` con suscripción puede iniciar el flujo; una web legítima comprometida también puede hacerlo sin que el propietario de ZenGuy la controle.

**Corrección requerida**

- [x] **Mitigación local versionada:** contenedor por intento/tenant, UID no privilegiado, filesystem read-only, credenciales mínimas, proxy de egress, DNS fijado por salto y denegación de rangos privados/reservados/metadata.
- [x] Interceptar con CDP Fetch solicitudes, redirects, subrecursos, WebSocket y service workers, con revalidación DNS; las pruebas adversariales cubren iframe, imagen, `fetch`, formulario, click, redirect y rebinding.
- [ ] **Cierre remoto:** publicar los digests firmados, desplegar compose/seccomp/firewall en el VPS y probar la cadena desde fuera. Separar el modelo local en otra red autenticada y no ejecutar el runner de trabajos no confiables en una estación de trabajo.

### SEC-02 — Crítica por encadenamiento; alta de forma aislada — Staging remoto tiene credenciales conocidas

- [ ] Corregido y verificado

**Evidencia**

- El proyecto declara staging como operativo en `README.md:58-78` y publica credenciales de acceso reutilizables en `README.md:128-142` y `apps/api/README.md:67-82`.
- `apps/api/scripts/seed.mjs:7-17,829-839,872-873,883-993,1030-1040` contiene passwords fijos, usuarios ya verificados con roles OWNER/ADMIN, una suscripción activa y una API key determinista.
- `apps/api/scripts/reseed-staging.mjs:7-13,28-38` fuerza el borrado y seed remoto con `--env staging`; `apps/api/package.json:20-21` expone el comando y `apps/api/wrangler.jsonc:66-75` publica las rutas de staging.

**Ataque e impacto**

Si el seed remoto documentado ha sido ejecutado, cualquier persona con acceso al repositorio puede iniciar sesión como propietario/administrador, leer la Public API y lanzar trabajos del navegador. Staging está separado de los datos de producción, pero comparte superficie operativa, coste de proveedores y el runner físico; por ello habilita directamente SEC-01.

**Corrección requerida**

- [x] **Mitigación local:** eliminar el reseed remoto y sus credenciales deterministas, mantener fixtures solo locales y hacer fail-closed el Access JWT de staging salvo el callback Paddle exacto.
- [ ] **Cierre remoto:** proteger o retirar staging, purgar usuarios/API keys/sesiones/jobs creados por fixtures, rotar credenciales y aportar smokes de Access desde ambos hostnames.
- [ ] Separar físicamente su runner del de producción y del Mac de un desarrollador antes de volver a aceptar jobs.

## Hallazgos de severidad alta

### SEC-03 — Alta — Secretos enviados por HTTP o conservados en redirects inseguros

- [x] Corregido y verificado

**Evidencia**

- `apps/api/src/shared/ssrf.ts:156-170` y `apps/api/src/domain/uptime/rules.ts:29-50` permiten HTTP y HTTPS.
- `apps/api/src/application/uptime/execute_check.ts:269-337` resuelve secretos y los sustituye en URL, headers y body antes de solicitar la URL.
- En redirects (`:340-407`) solo se eliminan headers/body cuando cambia `hostname`; se conservan al cambiar de HTTPS a HTTP o al cambiar de puerto en el mismo host.
- El runner también permite HTTP (`runner/browser_worker.py:856-888`), mientras que la autorización de secretos solo liga cada valor al hostname (`:801-825` y `apps/api/src/domain/secrets/rules.ts:31-81`), no al origen HTTPS completo.

**Ataque e impacto**

Un secret de monitor puede viajar en texto claro. Un redirect `https://host` → `http://host` o hacia otro puerto del mismo host conserva `Authorization`, cookies personalizadas o body sensible y los entrega a otro servicio/origen. En browser tests ocurre el mismo problema conceptual: autorizar un hostname permite usar el valor también sobre HTTP.

**Corrección requerida**

- [x] Prohibir sustitución de secretos fuera de HTTPS.
- [x] Ligar `allowedDomains` a un origen exacto o a una política que incluya esquema y puertos permitidos.
- [x] Comparar el origen completo (`scheme + host + effective port`) y eliminar credenciales/body ante cualquier cambio; no seguir redirects para requests con secretos salvo una política explícita y segura.
- [x] Bloquear siempre los downgrades HTTPS→HTTP.

### SEC-04 — Alta — Bearer único del runner con alcance global y secretos cross-tenant

- [ ] Corregido y verificado

**Evidencia**

- Un único `RUNNER_API_TOKEN` se carga por entorno (`apps/api/src/shared/config.ts:14-15,48-54,71-84,107-113,229-235`) y protege todas las rutas (`apps/api/src/http/routes/runner.ts:23-40`).
- `/attempts/claim-stale` puede seleccionar un intento de cualquier tenant (`runner.ts:52-65`; `apps/api/src/application/execution/external_runner.ts:192-217`).
- La respuesta del claim contiene snapshot y secretos en claro (`external_runner.ts:52-66,162-189`). El mismo bearer puede iniciar, registrar pasos y completar/falsificar el resultado (`runner.ts:68-107`).

**Ataque e impacto**

Robar el token en el runner primario o fallback permite drenar trabajos de cualquier workspace, obtener todos los secretos referenciados, falsificar resultados/evidencias y afectar incidentes o facturación. No hay identidad criptográfica distinta por runner, job o tenant.

**Corrección requerida**

- [x] **Mitigación local:** bootstrap primary/fallback independientes, capabilities HMAC de seis minutos ligadas a worker/attempt/generación/delivery, lease de secretos de un solo uso y contrato Access service-only sin humanos/bypass.
- [x] Verificar en el origin el JWT RS256 de Access y ligar su `common_name` exacto al `workerId` primary/fallback antes de despachar a la aplicación.
- [ ] **Cierre remoto:** crear/verificar la aplicación y sus dos service tokens, cargar `CF_RUNNER_ACCESS_AUD`, rotar los bearers antiguos y ejecutar smokes de denegación/replay en ambos hostnames. `claim-stale` continúa siendo un selector global cross-tenant y exige aislamiento real del fallback.

### SEC-05 — Alta — El runner carga un OAuth personal amplio de Wrangler

- [ ] Corregido y verificado

**Evidencia**

- `runner/browser_worker.py:424-455` ejecuta `wrangler auth token --profile zenguy-personal` en runtime.
- `runner/README.md:31-39` confirma que se usa un perfil OAuth personal. El valor queda en memoria y se envía como bearer para consumir Queue (`browser_worker.py:279-290,503-515`).

**Ataque e impacto**

Una explotación del navegador/proceso —especialmente SEC-01— puede robar una credencial con alcance mucho mayor que leer una cola, convirtiendo el compromiso del runner en compromiso de la cuenta Cloudflare.

**Corrección requerida**

- [x] **Mitigación local:** el runtime ya no ejecuta Wrangler ni carga OAuth; exige tokens Queue/Access dedicados, separados por rol/entorno, y los runbooks activos prohíben perfiles personales persistentes.
- [ ] **Cierre remoto:** revocar el OAuth/perfil legado, rotar y auditar los tokens Queue reales y guardar evidencia de scopes. Queue pull limita el token a nivel de cuenta, no a una cola concreta; para aislamiento fuerte se requieren cuentas separadas o un broker. Referencias: [Wrangler auth](https://developers.cloudflare.com/workers/wrangler/commands/general/) y [Queue pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/).

### SEC-06 — Alta — Paddle confía en metadata de checkout controlada por el navegador

- [x] Corregido y verificado

**Evidencia**

- El cliente proporciona `workspace_id` como `customData` y selecciona `priceId` (`apps/frontend/src/lib/paddle.ts:38-56,122-142`).
- El esquema de webhook no verifica items/producto/precio (`apps/api/src/application/billing/handle_paddle_webhook.ts:38-71`).
- `subscription.created` toma directamente `custom_data.workspace_id` (`:293-306`) y crea/asocia la suscripción (`:360-380`).
- `apps/api/src/infrastructure/db/subscription_repo.ts:56-84` sobrescribe la suscripción existente al colisionar por `workspace_id`.

**Ataque e impacto**

La firma de Paddle demuestra que Paddle emitió el evento, pero no que ZenGuy autorizó su asociación. Un atacante que conozca el UUID de otro workspace puede modificar el checkout, asociar su suscripción al workspace víctima y hacer que una cancelación/impago posterior afecte a la víctima. También falta verificar que el precio/producto cobrado sea exactamente el permitido.

**Corrección requerida**

- [x] Crear server-side un checkout intent opaco, de un solo uso, ligado a usuario, workspace, customer, producto, price, moneda e importe tras comprobar ownership. Consumirlo atómicamente en el webhook, validar todos los items y rechazar conflictos de customer/subscription. Como mínimo, firmar server-side la metadata y verificar esa firma.

### SEC-07 — Alta — La cuota de 300 runs no se aplica y se multiplica por workspace

- [x] Corregido y verificado

**Evidencia**

- Cualquier usuario autenticado/verificado puede crear workspaces sin límite específico (`apps/api/src/http/routes/workspaces.ts:93-100`).
- Cada workspace recibe una suscripción interna `ACTIVE` (`apps/api/src/application/workspaces/create_workspace.ts:57-72`).
- Crear un run solo comprueba que la suscripción esté activa y lo encola; no reserva ni consume cuota (`apps/api/src/application/browser_tests/create_run.ts:80-110`; `billing/ensure_active_subscription.ts:8-17`).
- Los 300 runs se calculan únicamente como métrica (`billing/get_cycle_usage.ts:55-75`) y el rate limit de 10/minuto se particiona por workspace (`browser_tests/run_rate.ts:5-13`).
- La cuota se anuncia al usuario (`apps/api/src/infrastructure/email/templates.ts:140-165`).

**Ataque e impacto**

Una cuenta gratuita puede ejecutar indefinidamente y crear muchos workspaces para paralelizar el límite, consumiendo navegador, LLM y colas a cargo de la plataforma.

**Corrección requerida**

- [x] Reservar cuota de forma transaccional antes de insertar/encolar; aplicar límites mensual/diario/concurrente por cuenta y usuario además de workspace; limitar la creación de workspaces y añadir topes globales de coste/anomalías.

### SEC-08 — Alta — Cambio de identidad sin teardown filtra cache y notificaciones entre cuentas

- [x] Corregido y verificado

**Evidencia**

- La SPA elimina/adopta sesión sin limpiar React Query (`apps/frontend/src/contexts/AuthContext.tsx:37-41,68-89`).
- El QueryClient es global (`apps/frontend/src/App.tsx:74-82`) y las claves no incluyen el usuario, por ejemplo `['workspaces']` (`apps/frontend/src/contexts/WorkspaceContext.tsx:65-92`). Se cachean miembros, runs/evidencias, billing y URLs privilegiadas de Paddle.
- La verificación de email puede sustituir la identidad activa directamente (`apps/frontend/src/pages/auth/VerifyEmail.tsx:50-82`; `apps/app/app/verify-email.tsx:26-74`).
- Móvil solo limpia cache al pasar por `signedOut`, no en `adoptSession` (`apps/app/src/contexts/AuthContext.tsx:42-46,77-80`).
- Push depende del booleano `eligible`, no de `user.id` (`apps/app/src/contexts/PushContext.tsx:62-73,115-132`); puede quedar registrado para A tras adoptar B y seguir mostrando alertas de A (`apps/api/src/infrastructure/notify/expo_push.ts:38-58`).

**Ataque e impacto**

En un navegador compartido, A cierra sesión y B entra sin recargar: B puede ver inmediatamente datos cacheados de A y reutilizar URLs sensibles. En iOS, un cambio A→B por verificación puede conservar cache y asociación push de A, exponiendo títulos/cuerpo de alertas en lock screen.

**Corrección requerida**

- [x] Implementar una transición atómica por `user.id`: cancelar requests, limpiar queries/mutations y `lastWorkspace`, desregistrar push con la sesión anterior, adoptar la nueva y registrar de nuevo. Incluir `user.id` en query keys sensibles y en las dependencias de `PushProvider`. Añadir pruebas A→logout→B y A→`adoptSession(B)` sin reload.

### SEC-09 — Alta — Staging y producción comparten capacidad de despliegue Cloudflare

- [ ] Corregido y verificado

**Evidencia**

- Staging y producción leen `secrets.CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` (`.github/workflows/staging.yml:24-35,45-50`; `.github/workflows/production.yml:37-48`).
- Ningún job declara un GitHub `environment:` que separe secretos o exija aprobación.
- Ambos workflows ejecutan Actions mediante tags mutables (`checkout@v4`, `pnpm/action-setup@v4`, `setup-node@v4`).

**Ataque e impacto**

Si el token tiene permisos de producción, un commit ejecutable desde la rama staging puede modificar el workflow, `package.json` o binarios y extraer/usar esa capacidad contra producción. El riesgo exacto depende de branch protections externas, no verificables desde el repositorio. Un takeover de un tag de Action también ejecutaría código antes de los pasos con credenciales.

**Corrección requerida**

- [x] **Mitigación local:** Actions y runners están fijados, los workflows usan Environments separados, refs exactas y fences contra el `main`/`staging` remoto; `CODEOWNERS` y el guard protegen los ficheros privilegiados.
- [ ] **Cierre remoto:** crear/verificar Environments y reviewers sin autoaprobación, reglas de ramas/tags y tokens Cloudflare distintos y mínimos. Si `Workers Scripts: Edit` no puede restringirse al script, separar cuentas o usar un broker.

## Hallazgos de severidad media

### SEC-10 — Media; alta si existe origin privilegiado — `fetch()` same-zone puede saltar Worker/WAF/Access

- [ ] Corregido y verificado

`apps/api/src/app.ts:291-302` ejecuta monitores con `globalThis.fetch`. Las configuraciones solo habilitan `nodejs_compat` (`apps/api/wrangler.jsonc:5-8` y `apps/api/wrangler.production-bootstrap.jsonc:5-7`) y omiten `global_fetch_strictly_public`. Cloudflare documenta que, sin el flag, un fetch a la misma zona puede ir directamente al origin, ignorar Workers mapeados y omitir ajustes de seguridad del edge. Un OWNER/ADMIN puede elegir la URL del monitor y alcanzar un origin `*.zenguy.com` con controles distintos.

- [x] **Mitigación local:** `global_fetch_strictly_public` está habilitado en todos los entornos/bootstrap y los monitores rechazan `zenguy.com`, sus subdominios y redirects hacia la zona propia.
- [ ] **Cierre remoto:** desplegar en staging/producción, conservar evidencia del flag en la versión activa y verificar que cada origin same-zone tenga autenticación propia. [Documentación de Cloudflare](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public).

### SEC-11 — Media — DoS por cuerpos HTTP bufferizados antes de autenticar/verificar

- [ ] Corregido y verificado

El webhook Paddle hace `await context.req.text()` antes de validar firma (`apps/api/src/http/routes/webhooks.ts:14-20`; verificación posterior en `billing/handle_paddle_webhook.ts:164-190`). Los parsers JSON genéricos también materializan el body antes del handler/rate limit y el import de browser tests lee todo antes de aplicar su límite de 2 MB (`http/routes/browser_tests.ts:288-303`; `domain/browser_tests/transfer.ts:68-75`). Requests muy grandes pueden agotar memoria/CPU del isolate sin credencial válida.

- [x] **Mitigación local:** contador streaming real previo a parsers/auth, cancelación inmediata y caps por ruta; `Content-Length` se usa solo como rechazo temprano y Paddle queda doblemente acotado.
- [ ] **Cierre remoto:** desplegar API/admin y verificar WAF/rate limits con bodies chunked, sin longitud, con longitud subestimada y excesiva.

### SEC-12 — Media — Auto-descarga de PDF/attachments sin cuota en el runner

- [ ] Corregido y verificado

`accept_downloads=False` (`runner/browser_worker.py:1189-1205`) no desactiva `auto_download_pdfs`, cuyo default en browser-use 0.13.8 es `true`. El `DownloadsWatchdog` descarga respuestas completas y las materializa en memoria; la limpieza ocurre al finalizar el intento. Una página hostil puede provocar OOM o llenar `/tmp` y tumbar el runner compartido.

- [x] **Mitigación local:** `auto_download_pdfs=False`, descargas CDP denegadas, cuotas por respuesta/intento, proxy acotado, filesystem read-only, tmpfs/cgroups y contenedor efímero.
- [ ] **Cierre remoto:** publicar y desplegar los digests firmados con seccomp/systemd, y probar PDF, attachments, compresión, múltiples respuestas, memoria y limpieza en el VPS.

### SEC-13 — Media — Rotación de refresh token no atómica

- [x] Corregido y verificado

`apps/api/src/application/auth/refresh.ts:24-50` lee el token, crea primero el reemplazo y después revoca el padre. `apps/api/src/infrastructure/db/refresh_token_repo.ts:59-70` revoca sin `revoked_at IS NULL` ni comprobar filas afectadas. Dos refresh concurrentes pueden crear dos hijos válidos del mismo token robado y evitar la detección normal de reutilización.

- [x] **Corrección:** reclamar/revocar condicionalmente el padre e insertar exactamente un hijo en una transacción; el perdedor debe activar revocación de toda la familia. Añadir test de carrera.

### SEC-14 — Media — Reset de password no invalida access tokens emitidos

- [x] Corregido y verificado

`apps/api/src/application/auth/reset_password.ts:44-50` cambia password y revoca refresh tokens, pero los JWT existentes siguen válidos hasta 30 minutos (`shared/constants.ts:6`; `infrastructure/auth/jwt.ts:21-52`). Un atacante conserva acceso después de que la víctima recupere la cuenta.

- [x] **Corrección:** `session_version`/`tokens_valid_after` validado en cada request e incrementado en reset y revocación global; reducir TTL o añadir `jti`/denylist para emergencia.

### SEC-15 — Media — Créditos de alertas no se reconcilian con importe ni refunds/chargebacks

- [ ] Corregido y verificado

El webhook de transacción no valida total neto/moneda (`apps/api/src/application/billing/handle_paddle_webhook.ts:53-71,237-265`) y solo procesa `transaction.completed`, no refunds, adjustments o chargebacks (`:204-219`), aunque el ledger contempla esos tipos (`domain/alerts/types.ts:42-47`). Un cliente puede gastar SMS/voz y después conservar créditos tras un reembolso/disputa.

- [x] **Mitigación local:** ownership, catálogo, precio, moneda y neto verificados; refunds/chargebacks/reversals idempotentes; balance negativo bloqueante; reconciliación periódica y topes D1 contra restauraciones sin respaldo.
- [ ] **Cierre remoto:** aplicar migraciones, provisionar `adjustment.read`, suscribir `adjustment.created/updated` y ejecutar en Paddle sandbox pruebas de refund, disputa, reversals, replay y webhook perdido antes de producción.

### SEC-16 — Media — Rate limiting KV no es atómico y se puede sobrepasar en paralelo

- [ ] Corregido y verificado

`apps/api/src/shared/ratelimit.ts:21-47` hace `get` seguido de `put`; el propio comentario reconoce consistencia eventual. Muchas solicitudes concurrentes/distribuidas pueden leer el mismo contador y superar límites de login, registro, runs o proveedores de pago.

- [x] **Mitigación local:** el contador principal es ahora una operación D1 atómica multi-scope; las pruebas concurrentes admiten exactamente el límite y cargan conjuntamente IP, usuario/cuenta y workspace.
- [ ] **Cierre remoto:** aplicar la migración/despliegue y añadir/verificar el prelimit WAF/Rate Limiting sin bypasses de IP Access.

### SEC-17 — Media — El deploy por defecto mezcla postura de desarrollo con recursos de producción

- [x] Corregido y verificado

La raíz de `apps/api/wrangler.jsonc:16-29` apunta a D1/KV/R2 de producción, mientras `:57-64` declara `ENVIRONMENT=development`, `APP_URL=http://localhost:5173` y Paddle sandbox. No se deshabilita `workers_dev`; `apps/api/package.json:8` ofrece `wrangler deploy` sin `--env`. Un deploy accidental puede publicar otro Worker accesible con datos productivos y cookies/controles de desarrollo, si existen los secretos necesarios.

- [x] **Corrección:** eliminar bindings productivos del bloque por defecto, usar recursos locales explícitos para dev, exigir `--env`, poner `workers_dev:false` donde corresponda y añadir un guard que aborte si recursos productivos aparecen con `ENVIRONMENT != production`.

### SEC-18 — Media — Advisories conocidos y Python no reproducible

- [x] Corregido y verificado

Los escáneres se ejecutaron contra los lockfiles/entorno instalados. La severidad upstream no equivale automáticamente a alcanzabilidad del producto:

| Superficie | Resultado | Alcanzabilidad observada | Acción |
| --- | --- | --- | --- |
| API/root | `extract-zip@2.0.1`, **high**, [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv); upstream aún no publica versión corregida | Transitivo de `@cloudflare/puppeteer`; el riesgo es extracción de ZIP con symlink fuera del destino. | Backport local sellado por hash y test adversarial que exige rechazo del symlink; la excepción CI tiene caducidad. |
| App Expo | `image-size@1.2.1`, dos **high**: [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) y [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | Metro/build-time; no runtime iOS. Requiere que el build procese una imagen maliciosa. | Parche local sellado y tests de progreso de parsers; mantener la excepción solo hasta actualizar Expo/Metro. |
| Runner Python | Sin advisories al consultar OSV sobre las versiones exactas del lock | `browser-use==0.13.8` fija tres versiones antiguas en metadata; el artefacto usa overrides de seguridad, por lo que debe probarse el lock real y no un venv heredado. | Lock transitivo con hashes, instalación `--require-hashes`, verificación explícita de overrides e imports y tests sobre ese mismo entorno. |

- [ ] **Seguimiento no bloqueante:** actualizar Expo/Metro y retirar la excepción CI temporal de `image-size`.

- [x] **Evidencia completada:** `runner/requirements.lock` fija el grafo completo con hashes y la imagen instala exactamente ese lock con `--require-hashes`; CI audita el mismo entorno y el workflow de imagen produce SBOM. Los dos lockfiles pnpm conservan integridad SHA-512 y los parches locales quedan fijados por hash y por pruebas de explotación negativas.

### SEC-19 — Media — Frontends sin cabeceras declaradas y script Paddle mutable

- [x] Corregido y verificado

No existe `_headers` ni otra política versionada para la SPA, website o landing; `apps/frontend/index.html:1-17` y los `wrangler.jsonc` estáticos no declaran CSP, `frame-ancestors`, HSTS, nosniff, Referrer-Policy o Permissions-Policy. Puede existir configuración externa no visible. Además `apps/frontend/src/lib/paddle.ts:75-103` carga `https://cdn.paddle.com/paddle/v2/paddle.js` mutable, con acceso al DOM y al access token en memoria.

- [x] **Corrección:** política versionada en Pages/Rules: CSP estricta, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`, allowlists mínimas de `connect/script/frame`, `Referrer-Policy: no-referrer`, nosniff, Permissions-Policy y HSTS. Usar URL/hash inmutable o SRI si Paddle lo soporta y cargar checkout solo donde se necesita.

### SEC-20 — Media — Bearer tokens en URL y deep links iOS reclamables

- [ ] Corregido y verificado

- Reset/verificación leen `?token=` y no limpian inmediatamente la URL (`apps/frontend/src/pages/auth/ResetPassword.tsx:29-42`; `VerifyEmail.tsx:50-82`); invitaciones/grants llevan capacidades en path (`apps/frontend/src/App.tsx:163-165`). Pueden permanecer en historial, logs de CDN/telemetría y Referer same-origin.
- iOS solo registra el esquema no verificado `zenguy` y mantiene desactivados Universal Links/AASA (`apps/app/app.config.ts:24,50-52`). Push transforma enlaces a `zenguy://` (`apps/api/src/infrastructure/notify/expo_push.ts:31-46`). Otra app puede reclamar el esquema, interceptar IDs/taps o presentar phishing; sería toma de cuenta si en el futuro se envían tokens bearer por ese canal.

- [x] **Mitigación local:** las capabilities se retiran inmediatamente de URL/deep link, permanecen temporalmente en memoria y se intercambian por POST; se añadieron `no-referrer`, AASA, `associatedDomains`, Universal Links HTTPS y push limitado al origen verificado sin query/fragment.
- [ ] **Cierre remoto/dispositivo:** publicar AASA con `200`, sin redirect y `application/json`; desplegar web/API, instalar un binario production nuevo y probar Universal Links/APNs en un iPhone físico.

### SEC-21 — Media local — Secretos reales con permisos de lectura amplios

- [ ] Corregido y verificado

`apps/api/.dev.vars` está ignorado por Git, pero se observó con modo `0644` y contiene material JWT/cifrado/artifacts y credenciales de Twilio, Paddle y OpenAI. El `ENCRYPTION_KEY` local observado coincide con el ejemplo público. `TWILIO_TOKENS.md` estaba correctamente en `0600`. No se encontraron esos paths en el historial Git.

- [x] **Mitigación local:** inventario fijo y auditoría metadata-only de tipo/owner/symlink/modo; los ficheros sensibles actuales tienen permisos privados y `.wrangler` queda en `0700`.
- [ ] **Cierre operativo:** migrar interactivamente `apps/api/.dev.vars` a Keychain, comprobar qué valores se reutilizaron y rotar/re-cifrar los que hayan salido de desarrollo; eliminar el fichero legado solo con autorización explícita.

### SEC-22 — Media — Redirects del cliente Python pueden filtrar bearers

- [x] Corregido y verificado

`runner/browser_worker.py:458-493` usa `urllib.request.urlopen` con redirects por defecto. Ese helper se invoca con tokens Cloudflare Queue (`:503-515`), runner (`:613-616,690-706`) y modelo (`:1882-1888`). Un endpoint confiable comprometido/mal configurado que responda con redirect cross-origin puede recibir `Authorization`.

- [x] **Corrección:** deshabilitar redirects o permitir únicamente mismo origen HTTPS; eliminar siempre credenciales ante cambio de esquema, host o puerto.

### SEC-23 — Media de hardening — AES-GCM global sin AAD ni rotación operativa

- [ ] Corregido y verificado

`apps/api/src/shared/crypto.ts:155-211` usa AES-GCM con IV aleatorio, pero sin `additionalData`. La misma key de entorno cifra secretos y configuraciones de todos los tenants (`application/secrets/resolve_secrets.ts:8-30`; `application/channels/create_channel.ts:64-73`) y solo existe versión 1. Con escritura sobre DB/backups se pueden intercambiar ciphertexts válidos entre registros; comprometer una key descifra todo el entorno.

- [x] **Mitigación local:** formato v4 con AAD de tipo/workspace/record/versión, DEK por workspace, KMS privado mediante Service Binding, key IDs, dual-read, rewrap y fencing transaccional de writers.
- [ ] **Cierre remoto:** desplegar KMS privado y `secret_key`, aplicar `0039/0040`, desplegar API y ejecutar creación/descifrado/rotación en staging antes de producción.

No es un exploit remoto independiente sin acceso de escritura/backup.

### SEC-24 — Media — PBKDF2 de passwords por debajo del baseline actual

- [x] Corregido y verificado

El estado original fijaba PBKDF2-HMAC-SHA256 en 100.000 iteraciones y un mínimo insuficiente. El formato actual es `pbkdf2-sha256$v1` con 600.000 iteraciones, salt de 128 bits, hash de 256 bits, parser estricto, techo de verificación, dual-read legacy y rehash-on-login con CAS. La política exige 15–100 code points Unicode y rechaza un corpus offline comprometido fijado por commit/checksum.

- [x] **Corrección:** elevar PBKDF2 tras medir CPU, versionar formato, dual-read/rehash-on-login y bloquear passwords comprometidos. Benchmark local con el Node 22.23.2 fijado, siete muestras: p50 41,92 ms, p95 42,13 ms, bajo el techo de 1.000 ms. [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- [ ] **Seguimiento no bloqueante:** repetir el benchmark en un Worker de staging y revisar periódicamente el corpus. Argon2id no está disponible en Workers WebCrypto.

### SEC-25 — Media de supply chain móvil — OTA sin firma y releases no reproducibles

- [ ] Corregido y verificado

`apps/app/app.config.ts:16-22` configura EAS Update sin certificado/metadata de code signing. Una cuenta Expo comprometida podría publicar JavaScript con acceso a la sesión/Keychain. `apps/app/eas.json:2-5` no exige commit limpio y `apps/app/README.md:222-254` usa `npx eas-cli@latest`, incluso avisando de que se suben cambios no commiteados.

- [x] **Mitigación local:** firma de EAS Update, fingerprint runtime, `requireCommit`, Node/pnpm/builder y `eas-cli@22.0.0` fijados con integridad; release/OTA usan `pnpm exec eas` desde tags current-main y entornos separados.
- [ ] **Cierre remoto:** proteger los Environments/tags, separar tokens, exigir MFA/roles mínimos, publicar primero el binario con certificado y probar una OTA firmada del mismo runtime en TestFlight/iPhone. [EAS Update code signing](https://docs.expo.dev/eas-update/code-signing/).

### SEC-26 — Media — App Lock no aísla accesibilidad

- [ ] Corregido y verificado

`apps/app/src/components/AppLockGate.tsx:23-51` dibuja un overlay absoluto como hermano del navegador (`apps/app/app/_layout.tsx:84-98`), sin semántica modal ni ocultar/desmontar el árbol subyacente. VoiceOver puede enfocar o activar controles sensibles detrás del lock visual.

- [x] **Mitigación local:** `AppLockBoundary` oculta el árbol protegido de accesibilidad y tacto durante carga/bloqueo, y el lock expone semántica modal accesible.
- [ ] **Cierre en dispositivo:** probar boot bloqueado, cancelación y desbloqueo con VoiceOver en un iPhone físico.

## Hallazgos de severidad baja / defensa en profundidad

### SEC-27 — Baja — Enumeración de cuentas

- [ ] Corregido y verificado

El registro revela explícitamente que un email ya existe (`apps/api/src/application/auth/register.ts:58-60`) y el login de un email inexistente no ejecuta el PBKDF2 dummy (`application/auth/login.ts:23-33`), generando señal de respuesta/timing. Los rate limits actuales no impiden enumeración distribuida.

- [x] **Mitigación local:** registro neutral y sin tokens/cookies, notificación solo al propietario de una cuenta existente, dummy KDF equivalente y verificación por token de inbox más contraseña original. Esto cierra también el pre-account takeover por registro previo de la víctima.
- [ ] **Cierre remoto:** desplegar protección anti-bot/rate limiting en el edge y resolver primero los bypasses de IP Access de SEC-51.

### SEC-28 — Baja — Invariantes de auth/API no reforzadas

- [x] Corregido y verificado

- Los tokens de email se leen y luego se marcan usados sin consumo condicional/transaccional (`email_token_repo.ts:50-71`; `verify_email.ts:35-47`; `reset_password.ts:32-50`). Dos requests pueden consumirlos concurrentemente.
- Los JWT no incluyen `iss`, `aud`, tipo ni `jti` (`apps/api/src/infrastructure/auth/jwt.ts:21-52`).
- Las respuestas que contienen tokens no declaran sistemáticamente `Cache-Control: no-store` (`apps/api/src/http/routes/auth.ts:168-253`).
- Las API keys no tienen scopes ni caducidad y el rate limit ocurre después de lecturas D1 (`http/routes/public_api.ts:103-158`; `application/api_keys/authenticate_api_key.ts:28-36`).
- La transferencia concurrente de ownership no tiene CAS/invariante única (`infrastructure/db/workspace_repo.ts:123-145`).
- `PAST_DUE` habilita ejecuciones sin un periodo de gracia explícito (`application/billing/ensure_active_subscription.ts:8-17`).

- [x] **Corrección:** consumos atómicos, claims y tipos explícitos, `no-store`, keys scoped/rotables/expirables, invariantes DB y política de dunning documentada.

### SEC-29 — Baja — Endurecimiento adicional del cliente

- [x] Corregido y verificado

- Billing abre URLs devueltas por API sin validar esquema/host ni pedir explícitamente `noopener,noreferrer` (`apps/frontend/src/pages/billing/BillingPage.tsx:263-268,302-320`).
- [x] Permitir solo HTTPS y hosts exactos de Paddle/documentos.
- Los reportes compartidos quedan en el cache iOS después de `shareAsync` (`apps/app/src/lib/share.ts:14-21`).
- [x] Borrar en `finally`, usar nombres aleatorios y limpiar rezagos al iniciar.
- `NSAllowsLocalNetworking:true` se incluye también en release (`apps/app/app.config.ts:41-47`).
- [x] Condicionarlo a desarrollo.
- Producción CI solo prueba la API (`.github/workflows/production.yml:28-36`) y no hay Renovate/Dependabot, OSV/audit, secret scanning o SBOM versionados.
- [x] Añadir gates para todos los artefactos y fijar versiones exactas de Node/pnpm/`packageManager`.

## Hallazgos adicionales de la segunda pasada

### SEC-30 — Alta — Una cuenta sin verificar puede reclamar la administración global

- [ ] Corregido y verificado

**Evidencia**

- El panel considera válido cualquier `200` de `/api/auth/login` y no inspecciona el `user.emailVerified` que ya devuelve la API (`apps/admin/src/server/routes/auth.ts:27-47,53-78`; `apps/api/src/http/presenters/user.ts:11-17`).
- Registro crea la cuenta con `emailVerifiedAt: null` y entrega una sesión inmediatamente; login admite expresamente esas cuentas (`apps/api/src/application/auth/register.ts:52-72,99`; `application/auth/login.ts:19-37`).
- La autorización privilegiada se basa solo en emails configurados (`apps/admin/wrangler.jsonc:25-27`; `server/require_session.ts:20-29`) y el Worker lee producción de forma cross-tenant.
- La sesión admin agrava el impacto: dura siete días, contiene solo `{email, exp}`, no tiene `jti` ni almacén de revocación y el logout solo borra la cookie del navegador (`apps/admin/src/server/constants.ts:4-5`; `server/session.ts:43-85`; `server/routes/auth.ts:82-85`). Un reset de password o logout remoto de la cuenta de producto no la invalida.
- Una sesión comprometida enumera email, nombre y actividad de usuarios y nombres de workspaces/tests/runs de todos los tenants (`apps/admin/src/server/db/users.ts:17-42`; `db/runs.ts:30-56`).

**Ataque e impacto**

Si se añade a `ADMIN_EMAILS` una dirección todavía no registrada, un atacante puede registrarla sin controlar ese buzón, elegir su password y entrar inmediatamente al panel. La precondición debe verificarse para el email configurado actualmente, pero el flujo de onboarding queda vulnerable por diseño. Separadamente, robar una cookie admin mantiene lectura global hasta siete días aunque el propietario cambie la contraseña. Una política externa de Cloudflare Access/MFA podría mitigar ambas vías, pero no existe evidencia versionada de ella.

**Corrección requerida**

- [x] **Mitigación local:** el panel exige email verificado, Access JWT y `user.id` estable; rechaza fixtures; usa sesión D1 opaca, revocable y de 30 minutos en cookie `__Host-`. Registro ya no entrega sesión y la verificación requiere token de inbox más contraseña original, cerrando la reclamación previa de identidad.
- [ ] **Cierre remoto:** comprobar que el identificador configurado actualmente pertenece al operador legítimo, crear Cloudflare Access sobre `admin.zenguy.com/*` sin bypass, exigir MFA, provisionar ese ID real como secret binding, aplicar migraciones/desplegar y probar anónimo, usuario no autorizado, fixture, operador, logout y reset.

### SEC-31 — Alta de negocio/privacidad — Borrar un workspace no es una saga durable ni una eliminación completa

- [x] Corregido y verificado

**Evidencia**

- El flujo escribe primero el tombstone. Después revoca invitaciones y trata el fallo de cancelación Paddle solo como log, sin outbox, reintento ni estado recuperable (`apps/api/src/application/workspaces/delete_workspace.ts:40-56`). La UI ya ha ocultado el workspace al propietario.
- El adaptador solo marca la suscripción local como `CANCELED` después de que Paddle responda correctamente (`apps/api/src/infrastructure/paddle/billing_canceller.ts:14-27`). Si la llamada falla, la suscripción remota puede continuar cobrando y el usuario ya no tiene acceso al billing del workspace.
- El borrado tampoco deshabilita channels/deliveries/outbox. El consumidor de notificaciones no comprueba que el workspace siga vivo y puede descifrar, cobrar y enviar después (`application/channels/send_queued_notification.ts:66-142`; `infrastructure/db/channel_repo.ts:72-84`).
- El purge posterior solo elimina secrets, channels, tests, monitors, members e invitaciones (`infrastructure/db/cleanup_repo.ts:161-238`). Conserva el workspace, API keys, suscripciones, usage/overages, auditoría, incidentes/eventos, ledger de crédito, jobs/outbox y otros registros; la prueba fija explícitamente varias de esas retenciones (`application/maintenance/purge_expired.itest.ts:371-381`). Runs sin `finished_at` tampoco entran en la retención ordinaria (`cleanup_repo.ts:16-25`).

**Ataque e impacto**

Un fallo transitorio de Paddle, D1 o Queues deja una operación parcialmente aplicada sin vía de usuario para reintentar: puede haber cobros indefinidos, SMS/llamadas posteriores y entrega de datos a destinos que el propietario cree eliminados. La retención incompleta amplía además el botín de una intrusión futura y contradice la promesa de eliminación permanente mostrada en `apps/frontend/src/pages/settings/SettingsPage.tsx:390-393,457-464`.

**Corrección requerida**

- [x] Introducir `DELETION_PENDING`/`CANCELLATION_PENDING` y una saga/outbox transaccional con reintentos y alertas hasta confirmación. Antes de ocultar definitivamente el workspace, deshabilitar channels, cancelar/refundar deliveries pendientes y terminalizar jobs/runs. Definir una taxonomía de retención con base legal, anonimizar lo que deba conservarse y probar automáticamente que toda tabla workspace-scoped se purga o anonimiza.

### SEC-32 — Media — Autoridad delegada sobrevive a revocación y offboarding

- [x] Corregido y verificado

**Evidencia**

- Accept hace `findValidByHash`, inserta la membresía y solo después llama a `markAccepted` (`apps/api/src/application/invitations/accept_invitation.ts:31-75`). Revocar también es read-then-write (`revoke_invitation.ts:24-38`).
- Los dos updates son CAS separados, pero sus repositorios devuelven `void`; nadie comprueba si cambió una fila (`infrastructure/db/invitation_repo.ts:81-93,113-131`).
- La aceptación valida token/email, pero no que `invitedBy` siga siendo miembro ni conserve permiso para conceder ese rol. Quitar/degradar al emisor o transferir ownership no revoca sus invitaciones de siete días (`application/members/remove_member.ts:22-46`; `change_member_role.ts:24-50`; `workspaces/transfer_ownership.ts:25-58`; `shared/constants.ts:10`).
- Quitar a un miembro solo elimina `workspace_members`. Las API keys que creó conservan `createdBy` pero autentican por sí solas sin revalidar al creador (`application/api_keys/create_api_key.ts:58-81`; `authenticate_api_key.ts:28-36`); channels/destinos que conocía también sobreviven (`application/channels/create_channel.ts:65-82`).

**Ataque e impacto**

Una aceptación iniciada antes de la revocación puede insertar el miembro después y dejar `markAccepted` como no-op. Además, un admin expulsado puede haber plantado invitaciones, o un owner puede emitir una invitación `ADMIN`, transferir ownership y recuperarla desde otra cuenta después de ser degradado/expulsado. Un ex-admin que conservó el plaintext de una API key creada por él mantiene lectura de la Public API hasta que otro administrador la identifique y revoque.

**Corrección requerida**

- [x] Consumir la invitación con CAS y exigir exactamente una fila antes de conceder acceso; idealmente `consume + INSERT membership` en una sola transacción/`INSERT … SELECT`. Revalidar atómicamente la autoridad actual del emisor y revocar sus invitaciones al quitarlo, degradarlo o transferir ownership. En offboarding, inventariar y rotar/revocar keys, invitaciones y destinos creados o conocidos por esa persona, con confirmación del owner para integraciones compartidas.

### SEC-33 — Media — El cierre de sesión no es terminal: refresh y push pueden sobrevivir

- [x] Corregido y verificado

**Evidencia**

- Web muestra `signedOut` y borra solo el access token aunque el POST de logout falle; la cookie HttpOnly únicamente se borra con una respuesta exitosa del servidor. En el siguiente reload se ejecuta refresh automáticamente (`apps/frontend/src/api/auth.ts:29-34`; `contexts/AuthContext.tsx:43-57,82-89`; `apps/api/src/http/routes/auth.ts:255-263`).
- `refreshInFlight` no tiene epoch/cancelación y siempre hace `setToken` al responder (`apps/frontend/src/lib/api.ts:104-123`). Móvil puede ejecutar `storeSession` después de que logout haya hecho `clearSession` (`apps/app/src/lib/api.ts:136-159`; `api/auth.ts:58-66`).
- Los single-flight de verificación conservan para siempre la Promise exitosa por token; en móvil esa sesión contiene también el refresh token (`apps/frontend/src/pages/auth/VerifyEmail.tsx:27-48`; `apps/app/src/components/auth/verify-email.ts:11-30`; `apps/app/src/api/auth.ts:11-17`). Reabrir un enlace antiguo tras iniciar sesión como otra cuenta puede volver a adoptar el usuario anterior mientras las credenciales efectivas pertenecen a la cuenta actual, otra variante de SEC-08.
- El teardown de push ignora error/timeout, pero borra el ID local aunque el `DELETE` falle (`apps/app/src/lib/session-hooks.ts:15-22`; `contexts/PushContext.tsx:149-159`). El auto-signout por rechazo no ejecuta ese hook (`lib/api.ts:126-169`; `contexts/AuthContext.tsx:75`).
- Backend envía a toda fila `enabled` sin TTL/`lastSeen`; solo un error definitivo de Expo la deshabilita (`apps/api/src/infrastructure/db/push_device_repo.ts:146-160,177-192`). El push contiene título/cuerpo e IDs del incidente/workspace (`infrastructure/notify/expo_push.ts:38-58`).

**Ataque e impacto**

Logout web offline/500 deja la cookie válida y un reload restaura la cuenta. Una respuesta de refresh tardía puede repoblar credenciales después del cleanup en web o Keychain. Independientemente, un dispositivo perdido que hace logout sin red, o que recibe una revocación/reset, puede seguir mostrando alertas sensibles indefinidamente. Esto no requiere el cambio A→B de SEC-08 ni que se explote la carrera de SEC-13, aunque ambas amplían la ventana.

**Corrección requerida**

- [x] Usar un epoch de sesión y `AbortController`; descartar toda respuesta iniciada antes de logout. El single-flight debe compartir solo peticiones pendientes y borrar su Map en `finally`, nunca retener sesiones. Mantener un tombstone local y no auto-refrescar hasta confirmar revocación; revocar atómicamente toda la familia cuando corresponda. Vincular push a una sesión/familia, revocarlo server-side en logout/reset, conservar un tombstone con retry, expirar dispositivos inactivos y retirar/desechar notificaciones locales.

### SEC-34 — Media — El único intento de redrive del DLQ se descarta si falla D1

- [x] Corregido y verificado

**Evidencia**

- Todos los consumidores `*-runs/checks/notify-dlq` tienen `max_retries: 0` y no encadenan un DLQ terminal en root, staging y production (`apps/api/wrangler.jsonc:51-53,121-135,202-216`).
- El handler llama expresamente a `retry()` si el redrive falla (`apps/api/src/index.ts:221-243`) y el contrato dice que un fallo antes de persistir debe dejar el mensaje reintentable (`application/durability/redrive_dead_letter.ts:44-48,88-104`). La configuración invalida esa garantía: Cloudflare elimina el mensaje al alcanzar los retries si no hay otro DLQ.
- En el mismo failure path se registra `JSON.stringify(body).slice(0,200)` sin redacción (`index.ts:213-229`; `shared/log.ts:3-10`). Un notify contiene título/líneas/link/textos (`domain/queues.ts:3-24`). El payload completo se conserva al cuarentenarlo, pero mantenimiento solo purga outbox publicado/jobs completados, no filas en cuarentena (`application/durability/maintenance.ts:11-45`; `infrastructure/db/durable_workflow_repo.ts:853-933`).

**Ataque e impacto**

Una caída del runtime o un fallo D1 justo cuando el mensaje ya agotó la cola original causa pérdida definitiva de un run, check o aviso. Poison messages/outages también copian datos operativos a Logs y pueden retener PII indefinidamente en D1. Es principalmente disponibilidad/confidencialidad operativa, pero un atacante que fuerce carga/fallos aumenta la probabilidad.

**Corrección requerida**

- [x] Dar al consumidor DLQ varios retries y un destino terminal/replay durable; probar la configuración además del código. Loguear solo queue/kind/message ID y métricas, nunca el payload. Aplicar TTL/purge explícito a cuarentena y límites de volumen. Véanse [retries de Cloudflare Queues](https://developers.cloudflare.com/queues/configuration/batching-retries/).

### SEC-35 — Media — Efectos externos se repiten sin idempotencia end-to-end

- [x] Corregido y verificado

**Evidencia**

- Una notification obtiene lease de cinco minutos, llama al proveedor y solo después persiste `SENT` (`apps/api/src/application/channels/send_queued_notification.ts:35,87-97,117-142,182-210`). Si esa persistencia falla, la fila continúa `PENDING` y se reclama de nuevo (`infrastructure/db/delivery_repo.ts:107-156`).
- La interfaz del sender ni recibe `deliveryId`; Slack/Discord/email/Twilio/push no pueden usar una clave estable del delivery desde ese contrato (`domain/channels/notifier.ts:13-17`; `infrastructure/notify/index.ts:56-114`). El update terminal tampoco está cercado por token/CAS, por lo que un worker viejo puede sobrescribir después de un takeover.
- Uptime permite `POST`, `PUT`, `PATCH` y `DELETE` (`domain/uptime/rules.ts:29-50`). El efecto remoto ocurre antes de insertar el check; ante error se libera el claim y Queue repite la ejecución (`application/uptime/handle_check_message.ts:86-114,117-169`).

**Ataque e impacto**

Si el proveedor acepta el SMS/llamada/email o el endpoint aplica un POST/DELETE, pero la respuesta/persistencia queda ambigua, el retry repite el side effect. El ledger local de alertas cobra una sola vez, pero ZenGuy paga y el usuario recibe varias llamadas/mensajes; un monitor puede ejecutar dos veces una mutación destructiva.

**Corrección requerida**

- [x] Pasar `deliveryId` como idempotency key donde el proveedor lo soporte, introducir estado `DISPATCHING/AMBIGUOUS`, reconciliar por provider ID y usar fencing token/CAS al finalizar. Restringir uptime a GET/HEAD por defecto; para métodos mutables exigir una clave estable por ciclo y no reintentar ciegamente resultados ambiguos. Cloudflare Queues ofrece entrega al menos una vez: [garantías oficiales](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).

### SEC-36 — Media — URLs visitadas conservan capabilities desconocidas y las publican a miembros

- [x] Corregido y verificado

**Evidencia**

- `sanitizeUrl` solo redacciona valores cuyo **nombre** de query coincide con `pass|token|secret|key|auth|code|session|signature|sig`; conserva todo pathname y cualquier parámetro con otro nombre (`apps/api/src/shared/redact.ts:95-106`). El runner replica ese patrón (`runner/browser_worker.py:858-881`).
- El runner reporta la URL de cada step y hasta cien URLs de historial (`runner/browser_worker.py:1391-1428,1459-1471`). La API vuelve a aplicar la misma sanitización y persiste ambos campos (`apps/api/src/application/execution/external_runner.ts:301-315,355-379`).
- Esas URLs aparecen en detalle y reportes (`application/browser_tests/get_attempt.ts:103-115`; `application/reports/generate_report.ts:197-203,282-299`). Un `MEMBER` puede ver tests y descargar reports (`domain/workspaces/permissions.ts:61-66`).

**Ataque e impacto**

Un destino puede redirigir a `/reset/<bearer>`, `?ticket=<capability>` o `?jwt=...`. Como el valor no es un secret configurado ni usa un nombre bloqueado, queda en D1/report y pasa de una sesión privilegiada del runner a cualquier miembro del workspace. Es distinto de SEC-20, que trata tokens propios presentes en URLs/deep links del cliente.

**Corrección requerida**

- [x] Persistir solo origin por defecto o path truncado; usar allowlist de parámetros seguros en lugar de denylist. Detectar JWT/cadenas de alta entropía/capabilities, ofrecer opt-in explícito para paths y no incluir URLs completas en reportes compartibles.

### SEC-37 — Media de hardening — Prompt injection se confía únicamente al prompt

- [ ] Corregido y verificado

**Evidencia**

- El system extension dice al modelo que ignore contenido de página, pero también permite otros dominios y acciones irreversibles si las instrucciones originales las requieren (`runner/browser_worker.py:126-149`).
- Solo se excluyen evaluate/files/upload; las acciones ordinarias de click, entrada, navegación y demás herramientas de browser-use permanecen (`runner/browser_worker.py:106-114,1241-1278,1665-1697`).
- La navegación personalizada acepta cualquier URL pública; no existe allowlist de origins del test ni un gate determinista de acciones de riesgo (`:1254-1276`).

**Ataque e impacto**

Contenido hostil visible en una página puede intentar inducir al modelo a navegar a `attacker.example/?d=<dato visible>` o confirmar una compra/borrado durante una sesión autenticada. El scope de secrets reduce la exfiltración directa de valores configurados, pero no protege datos visibles ni side effects. No se ejecutó un bypass contra el modelo remoto, por lo que la explotabilidad es probabilística; la ausencia de enforcement sí es verificable y debe tratarse como frontera no confiable, separada del SSRF de SEC-01.

**Corrección requerida**

- [x] Allowlist de origins/egress por test, gate determinista para navegación/acciones sensibles, confirmación humana para side effects y cuentas target de staging/test. DOM/texto permanece tratado como datos no confiables.
- [ ] Ejecutar evals adversariales E2E de prompt injection contra el modelo/runner desplegado y conservarlos como gate bloqueante.

- [x] **Mitigación local verificada:** el protocolo v2 liga por HMAC/SHA-256 las instrucciones y el snapshot completo. Cada acción DOM exige control único, tag/type esperados, formulario `POST` y `action` HTTPS exacta; el scope HTTP independiente liga origen/puerto, método, path y query. El runner revalida el control antes y después de la decisión y despacha el mismo `backendNodeId` por CDP, cerrando la carrera de índices/selector. Solo datos y credenciales atestados de staging/test pueden definir scopes; WebSocket, service workers, descargas, teclado libre, uploads, scheduled runs y acciones no enumeradas fallan cerrados.

- [x] Añadir un gate determinista ligado a la instrucción original y a aprobación humana por ejecución para acciones irreversibles.
- [ ] Aplicar migración `0045`, desplegar API/web/iOS/runner y ejecutar E2E adversarial real; ampliar la taxonomía solo mediante scopes nuevos explícitos y revisados.

### SEC-38 — Media — Los guardrails de alertas pagadas se eluden por carrera y por scope

- [x] Corregido y verificado

**Evidencia**

- El límite diario hace `SELECT COUNT`, compara y luego debita en operaciones distintas (`apps/api/src/application/alerts/charge_paid_delivery.ts:123-143`; `infrastructure/db/alert_repo.ts:299-308`). El débito protege saldo/idempotencia por delivery, pero no reserva el cupo diario (`alert_repo.ts:204-248`).
- El límite de test de channel usa `workspaceId + channel.id` (`application/channels/test_channel.ts:75-94`). Crear channels no tiene rate limit ni máximo de colección (`http/routes/channels.ts:162-179`), y cada channel email admite diez destinatarios (`domain/channels/types.ts:54-56`).
- `ADMIN` no tiene `billing.manage`, pero sí `channels.manage`; esta última capacidad autoriza activar canales pagados y elevar el límite hasta 200 (`domain/workspaces/permissions.ts:42-59`; `http/routes/alerts.ts:109-125`; `application/alerts/update_alert_settings.ts:24-83`). La UI lo trata como intencional, pero mezcla administración técnica con control financiero.

**Ataque e impacto**

Con el contador en `limit - 1`, varias deliveries concurrentes ven el mismo valor y todas cobran/envían por encima del tope financiero configurado. Para test, un ADMIN crea un channel, consume sus cinco envíos, crea otro y repite, pudiendo amplificar spam/coste dentro de un workspace. La capacidad efectiva de email arbitrario depende también de restricciones externas de Cloudflare Email Sending no inspeccionadas.

**Corrección requerida**

- [x] Reserva/contador de ventana actualizado condicionalmente en la misma transacción que el débito, con liberación/refund final. Rate limits por usuario/cuenta/IP/destinatario independientes del channel, máximo de channels y verificación/opt-in de receptores; los tests no deben saltar el guardrail financiero. Separar `paid_alerts.manage` y reservarlo al OWNER si el saldo es un control de billing.

### SEC-39 — Media — Colecciones ilimitadas convierten listados/exports en amplificadores D1

- [x] Corregido y verificado

**Evidencia**

- Crear browser tests no aplica cuota de colección ni rate de creación, y cada instructions admite hasta 10.000 caracteres (`apps/api/src/http/routes/browser_tests.ts:225-243`; `application/browser_tests/create_browser_test.ts:37-74`; `domain/browser_tests/rules.ts:18-31`).
- El repositorio carga todos los tests sin paginar y el use case añade dos consultas por test para channel/creator (`infrastructure/db/browser_test_repo.ts:98-109`; `application/browser_tests/list_browser_tests.ts:18-40`).
- GET y export usan ese listado completo; export además serializa toda la colección en memoria (`http/routes/browser_tests.ts:212-284`). Secrets y channels presentan un patrón de crecimiento semejante.
- Al descargar un report, cualquier `{{ARTIFACT:*}}` presente en el Markdown dispara un lookup D1 concurrente sin límite (`application/browser_tests/download_report.ts:13,78-97`). El report copia las instructions y descriptions del test (`application/reports/generate_report.ts:242-244,282-289`), por lo que un ADMIN puede plantar cientos de placeholders dentro de los 10.000 caracteres y un MEMBER repetir hasta 60 descargas/hora (`shared/constants.ts:90`). El scope check evita fuga cross-tenant, pero no la amplificación.

**Ataque e impacto**

Una cuenta ADMIN comprometida crea muchos objetos pequeños y hace que GET/export dispare miles de consultas y materialice grandes respuestas. Aunque el daño funcional empieza en su tenant, CPU/memoria/D1 son compartidos y puede degradar el servicio global. Es distinto del body único sobredimensionado de SEC-11 y de la cuota de runs de SEC-07.

**Corrección requerida**

- [x] Cuotas duras de objetos por plan/workspace, rate de creación por cuenta, paginación con cursor y joins/batching en lugar de N+1. Hacer exports grandes asíncronos/streaming con límites de tamaño y coste.

### SEC-40 — Baja — iOS deja evidencia y bearers en cache/clipboard tras cerrar sesión

- [x] Corregido y verificado

- Las vistas de screenshots no fijan `cachePolicy`; la versión instalada de `expo-image` usa disco por defecto (`apps/app/src/components/tests/ScreenshotViewer.tsx:98-104`; `AttemptDetail.tsx:77-85`; `RunStatusPanel.tsx:129-137`; `apps/app/node_modules/expo-image/ios/ImageView.swift:58`). La expiración de la URL firmada no borra esos bytes.
- Import usa `copyToCacheDirectory: true` y nunca elimina el JSON/YAML copiado (`apps/app/app/w/[wsId]/(tabs)/(tests)/tests/index.tsx:173-188`). Esto se suma al residuo de reportes compartidos ya descrito en SEC-29.
- El enlace bearer de grant se muestra y copia con `Clipboard.setStringAsync` (`apps/app/app/complimentary.tsx:102-108`; `src/components/CopyButton.tsx:16-20`). Es válido 30 días (`apps/api/src/shared/constants.ts:16`) y queda en el pasteboard global/Universal Clipboard sin expiración.

**Impacto:** backups, otra app, Universal Clipboard o acceso físico posterior al logout pueden recuperar evidencias o canjear el grant.

- [x] Usar cache de memoria/no-cache para artifacts, `Image.clearDiskCache()` en cambio de usuario/logout y borrar imports/reportes en `finally`.
- [x] Para capabilities, usar pasteboard local-only con expiración, limpiar condicionalmente y reducir TTL/añadir revocación.

## Hallazgos adicionales de la tercera pasada

### SEC-41 — Media — DoS criptográfico no autenticado en reset de contraseña

- [x] Corregido y verificado

La ruta calculaba el hash caro de la nueva contraseña antes de comprobar si el token era válido, por lo que tokens aleatorios permitían consumir CPU sin autenticación. Ahora valida primero el digest/token con una consulta barata, limita a 5 intentos por 15 minutos tanto por IP como por token, limita el token a 512 caracteres y conserva un consumo condicional atómico después del hash. Los tests cubren tokens inválidos/expirados/usados, fallo del KDF y la carrera entre dos consumos.

### SEC-42 — Media — Staging podía desplegar sin ejecutar los gates de seguridad

- [x] Corregido y verificado

El workflow de staging migraba y desplegaba sin depender del workflow de seguridad ni ejecutar las suites de API/admin. Ahora el job depende de `security-gates` y ejecuta typecheck, unitarios e integración antes de migrar o desplegar; el guard del repositorio comprueba esa dependencia y el orden.

### SEC-43 — Media — La imagen del runner aún no es un artefacto preconstruido, escaneado y firmado

- [ ] Corregido y verificado

Las bases y paquetes del runner eran mutables y el servicio systemd reconstruía la imagen al arrancar. Localmente se han fijado las bases por digest, APT a un snapshot inmutable y el arranque usa `--no-build`. El workflow ya separa validación sin privilegios de release, construye una vez, escanea, genera SBOM/provenance, publica por digest y firma con identidad OIDC. Sin el tramo pendiente no existe trazabilidad del artefacto realmente activo.

- [ ] Configurar reviewers y restricciones del Environment `runner-release`.
- [ ] Ejecutar una publicación real.
- [ ] Hacer que el VPS despliegue exclusivamente los dos `image@sha256` verificados.

### SEC-44 — Media — El contexto Docker podía incluir credenciales locales ignoradas por Git

- [x] Corregido y verificado

No había `.dockerignore`, así que una construcción desde `runner/` podía enviar al daemon ficheros locales ignorados con tokens/configuración. Los dos contextos usan ahora allowlists mínimas y el guard exige exactamente esos contenidos, evitando que archivos nuevos entren silenciosamente en la build.

## Hallazgos adicionales de la cuarta pasada

### SEC-45 — Alta — Un dispatch manual podía desplegar un ref arbitrario con credenciales privilegiadas

- [x] Corregido y verificado

Los workflows de staging y producción admitían `workflow_dispatch` sin exigir que el ref seleccionado fuese respectivamente `staging` o `main`. Un operador con permiso para ejecutar el workflow podía hacer checkout de otro commit y llegar a migración/deploy con los secretos del Environment. Ambos jobs exigen ahora la rama exacta, usan historial completo y comparan `GITHUB_SHA` con la cabecera remota inmediatamente antes de migrar y de desplegar; el guard del repositorio fija esas invariantes.

### SEC-46 — Alta — Chromium desactivaba sandbox y aislamiento de sitios dentro del contenedor

- [ ] Corregido y verificado

`browser-use==0.13.8` añadía en Docker argumentos que desactivaban el sandbox/zygote y reducían el aislamiento del renderer. Eso convertía un compromiso del navegador en acceso directo al contenedor y agravaba SEC-01. El árbol local elimina esos argumentos, exige sandbox y `--site-per-process`, verifica el argv final y prueba un lanzamiento real; también exige red bridge aislada, Docker 28+ y un perfil seccomp root-owned.

- [ ] Publicar las imágenes verificadas.
- [ ] Desplegar en el VPS el perfil seccomp y los digests nuevos.
- [ ] Verificar que no se usan `SYS_ADMIN`, `unconfined` ni el servicio antiguo.

### SEC-47 — Media — Respuestas comprimidas podían eludir la cuota de descarga del runner

- [x] Corregido y verificado

El contador CDP usaba solo `encodedDataLength`, por lo que una respuesta muy comprimible podía expandirse en memoria muy por encima del límite. Ahora contabiliza el máximo entre bytes codificados y decodificados, impone límites por respuesta y por intento, acota el número de requests rastreadas, limpia estado terminal y aborta el navegador al superar la cuota. Las pruebas cubren compresión, agregación y limpieza.

### SEC-48 — Alta — La publicación de imágenes daba permisos de registry/OIDC a refs no confiables

- [x] Corregido y verificado

El mismo job de imágenes podía ejecutarse para pull requests o manualmente con `packages: write` e `id-token: write`, ampliando innecesariamente el impacto de código de build hostil. El workflow separa ahora tests, imágenes de validación sin privilegios y release; solo un tag `runner-v*` del repositorio canónico, que apunta exactamente al `main` actual, entra al job con permisos de publicación y firma. La protección externa del Environment `runner-release` permanece incluida en SEC-43.

### SEC-49 — Media — Una rotación de DEK podía retirar una clave mientras otro writer aún la persistía

- [x] Corregido y verificado

Un writer podía cifrar con la DEK activa, perder la carrera contra la rotación y persistir después ciphertext ligado a una clave ya retirada. La migración `0040_encrypted_write_fence.sql` añade ocho triggers D1 para cercar atómicamente inserts/updates de secrets, channels y campos sensibles de uptime. Los writers reobtienen la clave y reintentan como máximo tres veces; la rotación trata rechazos como conflictos CAS, hace un barrido final y vuelve a comprobar la clave activa.

- [ ] **Activación remota pendiente; el control local sí está verificado:** aplicar `0039` y `0040` antes del Worker, sin despliegue gradual ni rotaciones concurrentes.

### SEC-50 — Media — Telemetría autenticada permitía amplificación de almacenamiento y truncado JSON inválido

- [x] Corregido y verificado

`POST /events` podía generar escrituras D1 sostenidas con una sesión válida y el truncado de metadata cortaba el texto serializado, produciendo JSON inválido. La ruta exige email verificado antes de consumir contadores y aplica límites burst y diarios por usuario/IP más un presupuesto global diario. La metadata sobredimensionada se guarda como un envelope JSON válido y acotado; las pruebas verifican límites, orden de autenticación y parseabilidad.

## Hallazgo adicional de la quinta pasada

### SEC-51 — Alta — Allowlist IP heredada omite WAF y rate limiting en todas las zonas de la cuenta

- [ ] Corregido y verificado

La inspección remota de solo lectura encontró 21 reglas IP Access activas con acción `Allow` y alcance **All websites in account**. No hay custom rules, rate limiting rules ni managed rules configuradas para `zenguy.com`. Cloudflare documenta que un `Allow` de IP Access se evalúa antes y omite custom rules, rate limiting, WAF Managed Rules y firewall rules; ese tráfico tampoco aparece en Security Events. Una IP ya no controlada, reasignada o comprometida puede por tanto evitar los controles que se añadan para Zenguy y atacar login, registro, reset, eventos o endpoints costosos sin la protección del edge.

- [ ] **Corrección requerida:** inventariar propietario y necesidad de cada entrada, revocar las desconocidas u obsoletas y eliminar el alcance global. Si alguna excepción sigue siendo imprescindible, sustituirla por una regla moderna limitada al hostname/path y por un `Skip` selectivo que conserve el resto de productos de seguridad. Después deben probarse desde una IP normal y desde cada origen autorizado tanto las reglas WAF como los límites. Referencias: [IP Access rules](https://developers.cloudflare.com/waf/tools/ip-access-rules/) y [interacción de fases](https://developers.cloudflare.com/waf/troubleshooting/phase-interactions/).

## Hallazgo adicional de la sexta pasada

### SEC-52 — Media — Un login concurrente podía sobrevivir a un reset de contraseña

- [x] Corregido y verificado

**Evidencia y ataque**

El flujo anterior verificaba la contraseña sobre un snapshot del usuario y después insertaba el refresh token sin volver a comprobar `password_hash`/`auth_version`. Si un reset terminaba su transacción entre ambas operaciones, revocaba los tokens existentes pero el login antiguo insertaba justo después una capability válida que el reset no había visto. Un atacante que conociera la contraseña anterior podía mantener la cuenta tras la recuperación y refrescar contra la identidad ya actualizada.

**Corrección aplicada**

- [x] Preasignar el ID del refresh, hacer CAS fail-closed del rehash, persistir la sesión y releer `passwordHash + authVersion`; si el snapshot cambió, revocar el token recién insertado y devolver el mismo error neutral de credenciales (`apps/api/src/application/auth/login.ts:60-103`).
- [x] Añadir una prueba determinista del orden explotable `reset commit → stale refresh insert → post-check`, además de la carrera de rehash (`apps/api/src/application/auth/login.test.ts:121-202`). La consolidación completa de API pasa con 1.015 tests unitarios y 366 de integración.

## Hallazgos adicionales de la séptima pasada

### SEC-53 — Media — El snapshot APT permitía rollback por un atacante on-path

- [x] Corregido y verificado

Los dos Dockerfiles del runner usaban el snapshot Debian por HTTP y desactivaban `Check-Valid-Until`. Las firmas APT impedían inventar paquetes, pero no que un intermediario sirviera metadata antigua todavía firmada y forzara una imagen con vulnerabilidades ya corregidas.

- [x] Usar exclusivamente `https://snapshot.debian.org`, disponer de CA antes del primer `apt-get`, fallar si falta el trust store y hacer que el guard rechace cualquier snapshot HTTP. La construcción real de la imagen sigue incluida en SEC-43/SEC-46.

### SEC-54 — Media — El lock Python con hashes aún permitía ejecutar sdists

- [x] Corregido y verificado

`pip --require-hashes` valida el archivo descargado, pero no impide elegir una distribución fuente y ejecutar su backend PEP 517 durante una build privilegiada. Un hash aprobado por error para un sdist ampliaría así la superficie de supply chain.

- [x] Instalar el lock completo con `--no-deps --only-binary=:all: --require-hashes` tanto en Docker como en CI y fijar esa invariante en el guard del repositorio.

### SEC-55 — Alta — La toolchain privilegiada de imágenes era mutable o vulnerable

- [x] Corregido y verificado

Buildx, BuildKit y el escáner dependían de tags/actions o cadenas de descarga sin fijar completamente; además, el verificador Cosign documentado era anterior a correcciones de validación relevantes. Ese job dispone de escritura en registry y OIDC, y un verificador vulnerable también comprometería la promoción por digest.

- [x] Descargar Buildx 0.36.1 y Trivy 0.73.0 por HTTPS, cada uno con un SHA-256 revisado; fijar BuildKit 0.32.2 por digest; usar Cosign 3.0.6 y exigir esa versión mínima también en el VPS. El workflow queda configurado para escanear el digest construido y volver a comprobar el ref autorizado antes de firmarlo. Referencias: [incidente de Trivy GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23) y [Cosign GHSA-whqx-f9j3-ch6m](https://github.com/sigstore/cosign/security/advisories/GHSA-whqx-f9j3-ch6m).

### SEC-56 — Media — Respuestas de proveedores sin límite podían agotar memoria

- [x] Corregido y verificado

OpenAI, Paddle, Expo, Twilio y Discord bufferizaban respuestas externas mediante `json()`/`text()` sin un límite real sobre el stream. Un proveedor comprometido o defectuoso podía entregar un cuerpo enorme o mentir en `Content-Length` y agotar memoria del Worker.

- [x] Contar bytes del stream, cancelar al exceder el cap, tratar `Content-Length` solo como rechazo temprano, decodificar UTF-8 de forma estricta y comparar longitudes decimales gigantes sin construir un `BigInt`. Paddle queda limitado además a diez páginas y el login admin a 64 KiB.

### SEC-57 — Media — Proveedores sin deadline y cuerpos abandonados podían agotar conexiones

- [x] Corregido y verificado

Paddle, Twilio, Expo, Slack y Discord no tenían un deadline explícito; algunos caminos de error o de respuesta status-only tampoco consumían ni cancelaban el body. Respuestas lentas o paginación adversarial podían retener subrequests/conexiones, bloquear colas y amplificar retries o efectos externos.

- [x] Aplicar un timeout de 10 s a esos proveedores, conservar 60 s para OpenAI, consumir de forma acotada o cancelar todo body ignorado —incluidos los caminos de error—, limitar Paddle a diez páginas y acotar también el upstream del login admin. `ZENGUY_API_ORIGIN` acepta únicamente producción HTTPS o loopback HTTP explícito de desarrollo.

### SEC-58 — Baja — La instalación de `pip-audit` no está cerrada transitivamente

- [ ] Corregido y verificado

El workflow fija `pip-audit==2.10.1`, pero instala sus dependencias transitivas desde el índice sin un lock completo con hashes. Un compromiso del índice o de una dependencia podría ejecutar código en el job de seguridad o falsear el gate, aunque ese job no hereda los secretos de despliegue.

- [ ] Generar un lock separado, completo y wheel-only para `pip-audit`; instalarlo con `--no-deps --only-binary=:all: --require-hashes` y actualizarlo solo mediante cambios revisados.

## Plan de remediación recomendado

### P0 — Antes de aceptar otro job no confiable

- [ ] Apagar/aislar el runner actual y ejecutar jobs en entorno efímero con bloqueo de egress (SEC-01/SEC-12).
- [ ] Cerrar staging, rotar fixture/API key/sesiones y separar su runner (SEC-02).
- [ ] Rotar y reducir OAuth Cloudflare y bearer del runner; capacidades por job (SEC-04/SEC-05).
- [x] Prohibir secretos sobre HTTP/downgrade y corregir redirects (SEC-03/SEC-22).
- [ ] Separar tokens CI de staging/producción y proteger environments (SEC-09).
- [ ] No publicar el panel admin hasta exigir identidad verificada, MFA y sesión revocable (SEC-30).
- [ ] Publicar el runner como imagen preconstruida, escaneada y firmada por digest (SEC-43).
- [x] Mantener contextos Docker con allowlists cerradas (SEC-44).
- [ ] Desplegar Chromium con sandbox/site isolation, seccomp y red Docker aislada (SEC-46).
- [x] Contabilizar bytes decodificados y cerrar la publicación privilegiada a refs no confiables (SEC-47/SEC-48).
- [x] Fijar snapshots, wheels, builders, escáneres y firmantes de la imagen (SEC-53/SEC-54/SEC-55).
- [ ] Retirar las 21 allowlists globales o convertir las excepciones justificadas en skips mínimos por hostname/path (SEC-51).

### P1 — Antes de producción pública

- [x] Crear checkout intents server-side ligados a workspace/precio/importe (SEC-06).
- [ ] Completar la reconciliación de Paddle y verificar su configuración remota (SEC-15).
- [x] Aplicar enforcement transaccional de cuota y topes de coste (SEC-07).
- [ ] Completar el rate limiting atómico y su enforcement externo (SEC-16).
- [x] Teardown total al cambiar `user.id`, incluido push (SEC-08).
- [ ] Activar/verificar `global_fetch_strictly_public` y body caps en los despliegues (SEC-10/SEC-11).
- [x] Separar los targets locales/remotos y reforzar las guardas de deploy (SEC-17).
- [x] Actualizar/lockear dependencias y añadir escaneo continuo (SEC-18).
- [x] Convertir el borrado en una saga recuperable y probar purge/notificaciones/billing (SEC-31).
- [x] Hacer atómicos consumo de invitaciones y límites financieros (SEC-32/SEC-38).
- [x] Corregir logout/refresh/push y la política de retries del DLQ (SEC-33/SEC-34).
- [x] Añadir idempotencia/fencing a efectos externos y minimizar URLs persistidas (SEC-35/SEC-36).
- [x] Validar y limitar reset-password antes de ejecutar el KDF (SEC-41).
- [x] Cerrar la carrera entre reset y creación tardía de sesión en login (SEC-52).
- [x] Hacer staging depender de gates y tests antes de migrar/desplegar (SEC-42).
- [x] Restringir los deploys manuales a la cabecera actual de su rama autorizada (SEC-45).
- [x] Acotar cuerpos, paginación, deadlines y conexiones de proveedores externos (SEC-56/SEC-57).

### P2 — Endurecimiento

- [x] Implementar CSP/cabeceras, KDF, cuotas/paginación, limpieza móvil y las mitigaciones locales de Universal Links, firma OTA, AAD/KMS, App Lock y policy enforcement (SEC-19 a SEC-29 y SEC-37/SEC-39/SEC-40).
- [ ] Desplegar y verificar en proveedor/dispositivo las partes remotas de Universal Links, OTA, KMS, App Lock y runner (SEC-20/SEC-23/SEC-25/SEC-26/SEC-37).
- [x] Cercar writers durante rotación de DEK y acotar/validar la telemetría (SEC-49/SEC-50).
- [ ] Crear el lock wheel-only y con hashes de la herramienta `pip-audit` (SEC-58).

## Controles positivos comprobados

- No se encontró IDOR/BOLA ordinario: `apps/api/src/http/middleware/workspace.ts:15-38` resuelve membership/rol en cada request y las consultas revisadas incluyen `workspace_id`.
- Invitaciones ligadas al email autenticado/verificado (`application/invitations/accept_invitation.ts:31-65`).
- Schemas Zod estrictos reducen mass assignment; no se encontraron queries SQL con input concatenado explotable.
- Refresh tokens, API keys, invitaciones y demás bearer secrets se almacenan hasheados.
- La Public API es read-only y tenant-scoped; secrets de canales aparecen enmascarados.
- Paddle valida HMAC con comparación constante, ventana temporal e idempotencia; SEC-06 se produce después, al confiar en metadata del cliente.
- CORS privado se limita al origen SPA; el wildcard está en la Public API autenticada por API key.
- El panel admin es read-only, no selecciona password/token/ciphertext, añade CSP/no-store y liga autorización a IDs estables más sesiones server-side revocables; SEC-30 continúa abierto hasta verificar en remoto identidad, MFA y despliegue del nuevo flujo.
- El error handler no expone stacks. Artifacts/SSE validan capacidades firmadas y resuelven el run dentro del workspace.
- Slack/Discord restringen destinos a hosts HTTPS oficiales (`apps/api/src/domain/channels/types.ts:69-85`); Twilio usa endpoint fijo y errores sanitizados. No se confirmó SSRF genérico en esos canales.
- Screenshot size/base64/JPEG se valida y las keys R2 se componen con IDs server-side. Los subprocesses del runner usan argv fijo y no `shell=True`.
- No se encontraron sinks XSS explotables (`dangerouslySetInnerHTML`, `eval`, `new Function`); el `set:html` Astro observado usa un mapa constante.
- Access tokens de cliente permanecen en memoria; el refresh token móvil usa SecureStore `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- El escaneo heurístico del árbol y 170 commits no encontró credenciales comunes o claves privadas trackeadas; los secretos locales detectados están ignorados por Git.

## Validación ejecutada

| Comprobación | Resultado |
| --- | --- |
| Typecheck | OK: API y admin con `wrangler types --check` más TypeScript, frontend y app |
| API: Vitest unitario | OK: 139 ficheros/1.015 tests |
| API: Vitest integración | OK: 61 ficheros/366 tests |
| Frontend: Vitest | OK: 74 ficheros/257 tests; build production OK |
| App: `tsc --noEmit` | OK |
| App: Jest | OK: 64 suites/261 tests; lint y release config OK. Jest conserva un handle asíncrono tras completar y la ejecución final usó `--forceExit` |
| Admin: typecheck | OK: Worker y cliente |
| Admin: Vitest | OK: 15 ficheros/71 tests unitarios, 5 ficheros/21 tests de integración, 2 tests de preflight y build production |
| Admin: preflight remoto de producción | Bloquea correctamente: falta provisionar `ADMIN_USER_IDS`; pendiente en SEC-30 |
| Runner: entorno de `requirements.lock` | OK: 87 tests |
| Secretos locales/FIFO | OK: 13 tests; 6/7 ficheros tienen metadata privada. `apps/api/.dev.vars` legado sigue pendiente de migración autorizada; no se leyeron valores |
| KDF de password | OK local con Node 22.23.2 fijado: 600.000 iteraciones; 7 muestras, p50 41,92 ms y p95 42,13 ms. Pendiente repetir en Worker |
| `pnpm audit` root/app | Solo advisories explícitas de `extract-zip`/`image-size`, con parches locales sellados, tests adversariales y caducidad documentada |
| `pip-audit` sobre `requirements.lock` | OK: 0 vulnerabilidades reportadas por OSV |
| `node scripts/security/check-repository.mjs` | OK: guardas de credenciales, deploy, CI, Docker y excepciones |
| `wrangler deploy --dry-run` | OK: API local/staging/production/bootstrap, KMS staging/production y admin; no se desplegó nada |
| `git diff --check` | OK |
| Build/scan/firma y smoke Linux de Chromium | No ejecutado: Docker no está disponible localmente; SEC-43/SEC-46 continúan abiertos |

**Validación pendiente**

- [ ] Probar rebinding real a través del proxy desplegado (SEC-01).
- [ ] Probar carga multiaisolate/remota de cuotas y rate limits (SEC-16).
- [ ] Verificar identidad y MFA externas del panel admin (SEC-30).
- [ ] Verificar los controles configurados únicamente en proveedores.
- [ ] Ejecutar la construcción, firma y promoción reales de imágenes en CI/registry (SEC-43/SEC-46).

## Límites de la auditoría

- No se realizaron pruebas destructivas ni explotación contra staging/producción.
- Se inspeccionaron en modo lectura la existencia y metadata no secreta de Cloudflare Access/WAF/Workers/D1, GitHub protections/Environments/secrets, Expo/Paddle y los servicios del VPS; no se leyeron valores secretos ni se modificó configuración remota. Los permisos efectivos de tokens, roles/MFA de Expo y configuración privada de Paddle/App Store no pudieron verificarse por completo.
- Un control externo puede mitigar algunos hallazgos de configuración, pero debe quedar versionado o aportarse como evidencia antes de cerrarlos.
- La revisión estática reduce, pero no elimina, la posibilidad de fallos no observados.
- [ ] Realizar un pentest desde una cuenta tenant de mínimo privilegio después de corregir P0/P1.

## Referencias técnicas

- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)
- [Expo EAS Update code signing](https://docs.expo.dev/eas-update/code-signing/)
