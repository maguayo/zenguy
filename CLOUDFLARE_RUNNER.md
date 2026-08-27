# Plan C definitivo: runner único en Cloudflare Containers

**Fecha:** 25 de agosto de 2026
**Estado (27-08, madrugada): F2 DESPLEGADA Y VERIFICADA EN PRODUCCIÓN.** El run programado de las 09:25 cargó cocunat.com, ejecutó 4 pasos con `gpt-5.6-luna` y terminó FAILED por el bloqueo DISEÑADO del ledger (Add to Cart sin autorización — el test tiene `writableDomains: []` y `actionAuthorizations: []`; los PASSED históricos venían del árbol viejo del VPS, anterior al ledger). Decisión de producto pendiente: autorizar la acción del carrito en el test o dejarlo como journey de solo lectura. Fixes que exigió la F2 sobre la F1: exención del proxy de egreso en modo cf (decisión 4 aplicada de verdad), argumentos especiales del wrapper `input` sin anotar (strings de `from __future__ import annotations` vs registry de browser-use), `--disable-dev-shm-usage` en cf (shm de 64M), instancia `standard-3`, y el guard CDP con pausas procesadas en tasks concurrentes + veredictos DNS coalescidos con TTL de 30 s (la verificación en línea serializaba la cola y ninguna página real podía cargar). Estado F1 previo:
**Estado (26-08, noche):** F2 **implementada en código y config** — producción despacha por `RunnerContainer` (`wrangler.jsonc` env production: containers + DO + `RUNNER_DISPATCH=container`), identidad cf en el muro de Access de producción vía secret `RUNNER_CF_ACCESS_COMMON_NAME`, y rescate horario de attempts QUEUED nunca reclamados (`zombie_unclaimed_attempt`, cierra el hueco que dejó el poller al desaparecer). Suites: API 1054 unit + 366 integración (los 3 fallos billing son el entorno local sin STRIPE_*, pre-existentes). Imagen validada localmente con Colima (`--verify-image` OK). **Nota:** el 25-08 se ejecutó el paso 3 (retirar unidades del VPS) sin activar antes ningún sustituto: producción está sin ejecutor desde las 23:26 CEST del 25-08 y el run `run_01m0xe5fts…` quedó QUEUED bloqueando el scheduler (el sweep nuevo lo rescatará solo). Pendiente en manos de Marcos: Zero Trust + secrets + deploy — ver "Runbook F2" al final.
**Hallazgo de F2 (verificado en la doc de Cloudflare):** el claim `common_name` de una aserción Access de service token es el **Client ID** (`<hex>.access`), no el nombre del token. Los valores hardcodeados de `RUNNER_IDENTITIES` para primary/fallback (`zenguy-production-*-runner`) nunca pudieron validar y no se habían ejercitado (el middleware entró a producción el 26-08 con los runners ya parados); la identidad cf usa el Client ID real vía secret. Limpiar primary/fallback en F3.
**Decisión (Marcos, 25-08):** el ejecutor de browser-tests pasa a ser **Cloudflare Containers + OpenAI `gpt-5.6-luna`** con la escalada de reasoning `low → medium → high` que ya implementa el modo fallback. El Mac y el VPS dejan de ser infraestructura de ejecución.

## Por qué

- Las dos unidades del VPS siguen en la topología en cuarentena de `BACKUP_RUNNER.md` (verificado en vivo el 25-08: Python+Chrome directos en host, commit 774db2a, sin contenedor ni proxy de egreso). Migrarlas al stack Compose firmado es trabajo de host que Containers hace innecesario.
- Cada contenedor de Cloudflare corre en **su propia VM efímera**: aislamiento por run estrictamente mejor que el objetivo Compose, sin administrar host, cosign ni systemd.
- Números reales (65 runs del fallback, 21→25-08, ya con `gpt-5.6-luna` y la escalada low/med/high): mediana 69 s, media 72 s, p95 124 s, máx 201 s, ~20-25 runs/día (~700/mes).
- Coste a ese ritmo: **~$1.4/mes de contenedores** (tras las franquicias del plan Workers de $5 ya pagado) **+ ~$8-20/mes de OpenAI**. El compute es ruido; la factura real es el modelo, y ya la pagábamos en cada run del fallback.
- Latencia: **mejora**. Sin primario ya no existe la ventana de exclusividad de 10 s: el run arranca al crearse (cold start 2-3 s + boot ~3-6 s ≈ navegador ejecutando en ~5-9 s).

## Arquitectura objetivo

```
API (Worker) crea el attempt (initial o retry)
  → AttemptDispatch (puerto nuevo; hoy: RUN_QUEUE.send)
    → RunnerContainer DO, getByName(attemptId)
      → start({ envVars: AttemptMessage + credenciales })   ← imagen del runner, one-shot
      → schedule(+8 min) como watchdog
Contenedor: claim (protocolo actual, sin cambios) → browser-use → complete → exit
DO alarm: si el attempt sigue STARTING/RUNNING pasado el deadline+gracia → recovery WORKER_LOST existente
```

- El camino nuevo no usa colas. `RUN_QUEUE` y el modo queue del worker quedan **aparcados como palanca de emergencia manual** (encender el Mac y drenar) mientras Containers esté en beta; se retiran cuando salga.
- `max_instances` del binding limita la concurrencia (empezamos con 5; hoy se ejecuta en serie).
- `instance_type: standard-2` (1 vCPU, 6 GiB, 12 GB). Si el spike muestra >20 % de regresión en duración, subir a `standard-3` (2 vCPU, ~×1.6 de coste, sigue <1 céntimo/run).

## Qué NO cambia (el protocolo de seguridad sobrevive entero)

Capabilities de 6 minutos por attempt con HMAC; ledger atómico de acciones irreversibles (DOM/HTTP scopes 1-3 usos); `BrowserNetworkPolicy` CDP que intercepta toda navegación/subrecurso/redirect contra el allowlist por job; secretos con placeholder y scope por dominio HTTPS, nunca en el prompt; redacción de secretos en steps; acciones de fichero/`evaluate`/`send_keys` excluidas del modelo; page content tratado como no confiable en el system prompt; topes 32 MiB/respuesta y 256 MiB/attempt; descargas denegadas por CDP; versiones lockeadas con hash y `--verify-locked-runtime`; escalada de reasoning por intento funcional.

## Decisiones de diseño

1. **Handoff por `envVars`, protocolo intacto.** El DO pasa el `AttemptMessage` serializado + `deliveryId` (`cf-<uuid>`) al contenedor, que llama al `POST /api/runner/attempts/claim` de siempre. El arbitraje atómico en D1 (`UPDATE … WHERE status='QUEUED'`) sigue decidiendo; un doble arranque recibe `SKIP` y muere inofensivo.
2. **Identidad y token nuevos:** `zenguy-<env>-cf` con `RUNNER_CF_API_TOKEN` (tercer modo en `requireWorkerIdentity`, junto a `local`/`fallback`). Rotación limpia: los tokens viejos se revocan en F3 sin ambigüedad de quién era quién.
3. **Guards adaptados, no debilitados.** Nuevo `assert_cloudflare_runtime` para el modo `--cloudflare`: Linux + uid/euid 10001 (lo fija la imagen) + `CLOUDFLARE_DURABLE_OBJECT_ID` presente + `ZENGUY_ISOLATED_RUNNER=cloudflare` + un solo attempt y exit. El gate Compose (`assert_isolated_fallback_runtime`) queda intacto para el modo fallback mientras exista.
4. **Egreso.** En CF no hay sidecar Squid ni host/LAN nuestros que proteger; la frontera de red pasa a ser la capa CDP por job + `assert_public_network_url` (DNS resuelto y verificado público). `ZENGUY_EGRESS_PROXY` se vuelve opcional solo en modo `--cloudflare`. Opcional futuro: proxy dentro de la propia imagen como segunda valla.
5. **Secretos** (`OPENAI_API_KEY`, `RUNNER_CF_API_TOKEN`, par de Access): Worker secrets → `start({envVars})`. Nunca en la imagen. El scrub de entorno pre-Chromium sigue aplicando.
6. **Imagen:** la misma `runner/deploy/Dockerfile` (base pinneada por digest, `USER 10001`, lock con hashes). El modo se elige con `entrypoint` desde la clase Container (`["python", "/opt/zenguy/runner/browser_worker.py", "--cloudflare"]`), sin tocar el Dockerfile. `wrangler deploy` construye y pre-distribuye la imagen (requiere Docker local en el Mac al desplegar).
7. **Watchdog:** `schedule(+8 min)` en el DO al arrancar; el `alarm` consulta el estado y dispara la recuperación `WORKER_LOST` existente. Sustituye al sweep que hacía el poller del fallback (que desaparece).
8. **Observabilidad:** Workers Logs para el contenedor + heartbeats actuales hacia el admin durante el run. `runnerVersion = zenguy-cf-runner/…` y `runner_kind = "cf"` para distinguirlo en UI/BD.
9. **Modelo:** `gpt-5.6-luna` con la escalada existente, sin tocar. Nota de expectativas: el reasoning bajo ahorra tokens de salida; el coste lo domina la entrada (DOM+capturas por paso), que no depende del nivel — el presupuesto sale de los 65 runs reales, no de la teoría.

## Riesgos asumidos y mitigación

| Riesgo | Mitigación |
| --- | --- |
| Containers está en beta, sin SLA | Palanca de emergencia: modo queue del Mac aparcado y documentado; revisar al salir de beta |
| Dependencia dura de OpenAI | Igual que el fallback hoy; `SYSTEM_ERROR/LLM_UNAVAILABLE` ya se reporta así; `ZENGUY_FALLBACK_MODEL_BASE_URL` permite otro proveedor OpenAI-compatible |
| Cold start o CPU peores de lo documentado | El spike de F1 los mide con criterios de salida numéricos antes de tocar producción |
| Rolling deploy de imágenes (versiones conviven unos minutos) | `runnerVersion` identifica qué ejecutó cada attempt |

## Fases

**F1 — Spike en staging** (plan detallado: `docs/superpowers/plans/2026-08-25-cf-runner-fase1.md`). Salida: un run E2E `PASSED` en staging ejecutado por Containers, cold start medido ≤5 s, coste/run medido en el dashboard, duración sin regresión >20 % vs mediana 69 s, y el watchdog probado matando un contenedor a mitad de run.

**F2 — Producción.** `RUNNER_DISPATCH=container` en prod, worker del Mac apagado como dependencia (código aparcado), cola muda. Una semana de observación con el admin.

**F3 — Desmantelamiento y rotación** (en este orden):

```bash
# En el VPS (root@142.132.220.44):
systemctl disable --now zenguy-fallback zenguy-fallback-staging
rm /etc/systemd/system/zenguy-fallback*.service && systemctl daemon-reload
rm -rf /opt/projects/zenguy /etc/zenguy    # el server queda solo para dailyer/foldea/larvai

# Colas (token efímero de Queue config, nunca OAuth personal):
pnpm --filter @zenguy/api exec wrangler queues consumer http remove zenguy-staging-runs
# (producción nunca llegó a tener consumidor HTTP)

# Rotar TODO lo que vivió en el entorno del despliegue en cuarentena:
#   OPENAI_API_KEY (dashboard OpenAI), RUNNER_API_TOKEN, RUNNER_FALLBACK_API_TOKEN,
#   los dos pares de Cloudflare Access del runner, y retirar sus secrets del Worker.
```

## Coste proyectado (todo incluido)

| Ritmo | Contenedores (neto franquicias) | OpenAI | Total/mes |
| --- | --- | --- | --- |
| 300 runs/mes | ~$0.4 | ~$3-9 | **~$4-10** |
| 700 (actual) | ~$1.4 | ~$8-20 | **~$9-21** |
| 3.000 | ~$8.4 | ~$35-90 | **~$43-98** |

Se elimina: VPS del runner (o su alternativa dedicada de 4-8 €/mes), la migración Compose pendiente, la dependencia del Mac encendido, y la ventana de 10 s de cada run del plan B.

## Runbook F2 (manos de Marcos; comandos listos para `!`)

Ya hecho por la sesión del 26-08: Colima+docker instalados y la imagen
construida y verificada en este Mac; migraciones de producción al día (0046 y
0047 aplicadas); config F2 commiteada; suites en verde. El paso 3 del runbook
original (retirar el VPS) se ejecutó el 25-08. Staging queda fuera de juego
como gate: su Worker desplegado es del 23-08 y le faltan ~9 secrets (todos los
STRIPE_*, CF_ACCESS_AUD, EXPO…) y la propia app de Access; repararlo es un
trabajo aparte. La validación E2E de F2 es el primer run controlado de
producción (el rescate horario reactiva `run_01m0xe5fts…` solo).

```bash
# 1. Zero Trust (dashboard, una vez) — contrato exacto en
#    security/cloudflare-runner-access-policy.json:
#    a. Access → Service auth → Create service token: nombre
#       "zenguy-production-cf-runner". Copia Client ID y Client Secret.
#    b. Access → Applications → Add self-hosted: "zenguy-production-runner",
#       hostnames api.zenguy.com y app.zenguy.com, path /api/runner/*, sesión
#       mínima, UNA política tipo Service Auth que incluya solo ese token.
#       Copia el AUD de la aplicación.

# 2. Secrets de producción (pegar en el prompt interactivo; COMMON_NAME es el
#    MISMO Client ID del paso 1a — common_name real de la aserción):
pnpm --filter @zenguy/api exec wrangler secret put CF_RUNNER_ACCESS_AUD --env production
pnpm --filter @zenguy/api exec wrangler secret put RUNNER_CF_ACCESS_CLIENT_ID --env production
pnpm --filter @zenguy/api exec wrangler secret put RUNNER_CF_ACCESS_CLIENT_SECRET --env production
pnpm --filter @zenguy/api exec wrangler secret put RUNNER_CF_ACCESS_COMMON_NAME --env production
openssl rand -hex 32 | pnpm --filter @zenguy/api exec wrangler secret put RUNNER_CF_API_TOKEN --env production
# OPENAI_API_KEY_CF: pega una key del dashboard de OpenAI (o reutiliza la del
# fallback si prefieres; se rota en F3 igualmente):
pnpm --filter @zenguy/api exec wrangler secret put OPENAI_API_KEY_CF --env production

# 3. Deploy de producción (construye y sube la imagen con el docker de Colima;
#    también vale push de main si prefieres pasar por el gate de CI):
pnpm --filter @zenguy/api exec wrangler deploy --env production

# 4. Verificación (la hace la sesión, solo lecturas): al cron de :30 el sweep
#    marca el run zombi WORKER_LOST→SYSTEM_ERROR; al siguiente */5 el
#    scheduler crea el run horario, el DO arranca el contenedor y el claim
#    llega como zenguy-production-cf; PASSED en D1 y heartbeat mode cf.

# 5. Admin (deploy manual como siempre) para ver la etiqueta "Cloudflare (Containers)".
```

Nota: si el deploy (paso 3) corre antes que los secrets (paso 2), no pasa nada
peor que hoy — el dispatch falla en `buildRunnerEnvVars`, el outbox lo
reintenta con el job de durabilidad y todo fluye en cuanto existan los
secrets. El orden 2→3 evita ese ruido.

## Límites conocidos

- `wrangler deploy` con bloque `containers` necesita Docker corriendo en la máquina que despliega.
- El disco del contenedor es efímero por diseño (nos da igual: el attempt es one-shot).
- Los límites de cuenta (1.500 vCPU / 6 TiB concurrentes) quedan a tres órdenes de magnitud del uso previsto.
- El tree tiene trabajo sin commitear de otras sesiones en `runner/browser_worker.py` y docs; la tarea que toca ese fichero exige coordinación previa (ver plan F1).
