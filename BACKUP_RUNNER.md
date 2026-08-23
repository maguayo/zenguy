# Plan B: worker de respaldo (fallback runner)

**Fecha:** 20 de agosto de 2026
**Estado (actualizado 23-08-2026):** **activo en producción y en staging.** El servidor dedicado (`142.132.220.44`, repo en `/opt/projects/zenguy` siguiendo `main`, Google Chrome headless, Python 3.12) corre dos unidades systemd con el mismo runner: `zenguy-fallback` (producción: `--fallback`, credenciales en `/etc/zenguy/fallback.env` con el `RUNNER_API_TOKEN` de producción) y `zenguy-fallback-staging` (`--fallback --staging`, `/etc/zenguy/fallback-staging.env`). Hasta el 23-08 solo existía la unidad de staging, así que un run de producción creado con el worker local apagado se quedaba en `QUEUED` indefinidamente (la cola `zenguy-runs` de producción no tiene consumidor push; solo la drena el worker local por pull). El primer run de producción ejecutado por el plan B fue `run_01m0nqgdbh8s1kf3kww9819pkh` (`PASSED`, 64 s, gpt-5-mini, `runnerVersion zenguy-fallback-runner/2.0.0`). En staging quedó validado extremo a extremo el 21-08 con runs reales de gpt-5-mini: un fallo funcional legítimo con retry y un `PASSED` limpio. Los errores del proveedor LLM (cuota/auth/conexión) se reportan como `SYSTEM_ERROR/LLM_UNAVAILABLE`, no como `FAILED`. Los tests seed de staging se siembran aparcados (`next_run_at` 2030) para que el daemon no ejecute basura tras cada reseed; para un run real en staging, adelanta `next_run_at` de `bt_seed_homepage`. Actualizar el VPS: `git -C /opt/projects/zenguy pull --ff-only && systemctl restart zenguy-fallback zenguy-fallback-staging`.

## Qué pediste

> El run, una vez elegido por el worker local, se marca como "cogido". Si después de 10 segundos no ha sido cogido, un worker de respaldo en un VPS lo ejecuta con un modelo barato (gpt-5 mini o similar).

## Qué hay ahora

- La marca de **"cogido" ya existía** y la he reutilizado tal cual: el claim del runner transiciona el attempt `QUEUED → STARTING` de forma atómica en D1 y guarda el lease `runner_delivery_id` (migración `0016`). No inventé una segunda marca.
- **Nuevo endpoint** `POST /api/runner/attempts/claim-stale` (mismo token `RUNNER_API_TOKEN`): entrega el attempt **más antiguo** que lleve **≥ 10 segundos** reclamable y siga sin coger. Si no hay nada, responde `SKIP`.
- **Nuevo modo del worker Python**: `./browser_worker.py --fallback [--staging]`. Es el mismo ejecutor `browser-use` de siempre, pero:
  - no toca Cloudflare Queues (ni necesita Wrangler ni credenciales de Cloudflare);
  - sondea `claim-stale` cada 5 segundos;
  - usa la **API de OpenAI** con `gpt-5-mini` por defecto, en headless.
- Mientras el worker local esté sano, el fallback **no ejecuta nada** (todo se coge en <10 s). Si el local va lento, se queda sin internet o sin luz, el fallback empieza a coger trabajo solo, sin intervención.

## Decisiones que tomé (y por qué)

1. **Pull contra la API, no un segundo consumidor de cola.** Si el VPS hiciera pull de la misma Cloudflare Queue, competiría con el local por cada mensaje desde el segundo 0 (el pull invisibiliza el mensaje para el otro consumidor), y la regla de "10 segundos de exclusividad para el local" sería imposible de aplicar. Una segunda cola con delay habría funcionado, pero añade infraestructura (cola + consumer + IDs) para algo que D1 ya sabe responder: "¿qué attempts siguen QUEUED desde hace ≥10 s?". El poll es 1 petición ligera cada 5 s.

2. **Los 10 segundos viven en el servidor**, como `FALLBACK_CLAIM_MIN_AGE_MS = 10_000` en `apps/api/src/shared/constants.ts`. El worker de respaldo no decide la política; solo pregunta. Cambiar la ventana es tocar una constante y desplegar la API.

3. **Los retries con delay se respetan solos.** El `queued_at` de un retry (60 s / 120 s) es su instante de disponibilidad, y `executionGeneration == queued_at`. El fallback solo ve un retry 10 s después de su hora programada, nunca antes. No hizo falta lógica extra.

4. **Reutilicé el claim existente al 100 %.** `claimStale` construye el mismo `AttemptMessage` que llegaría por la cola y llama al `AttemptLifecycle.claim` de siempre. Toda la protección ya probada aplica igual: lease idempotente, generación de ejecución, runs terminales, runs de tests borrados, facturación idempotente en `markRunning`. Si local y fallback llegan a la vez, el `UPDATE ... WHERE status='QUEUED'` atómico decide; el perdedor recibe `SKIP` y (en el caso local) ACKea su mensaje. **No puede haber doble ejecución.**

5. **El fallback también cura zombis.** `claim-stale` además saca a la superficie attempts `STARTING/RUNNING` cuyo worker murió (started_at > timeout de 5 min + 2 min de gracia). Reclamarlos dispara exactamente la recuperación `WORKER_LOST` + infra-retry que ya disparaba una redelivery de la cola. Antes, si el local moría con el mensaje ya ACKeado o atascado, la recuperación dependía del cron horario; ahora el propio fallback la provoca en minutos. Con el local totalmente muerto, el sistema entero se auto-repara.

6. **Modelo barato y configurable, `gpt-5-mini` por defecto.** Mencionaste "gpt 5.6 luna": no tengo confirmado ese identificador de API, así que en lugar de hardcodear un id que podría no existir, el modelo es `ZENGUY_FALLBACK_MODEL=<id>` sin tocar código (p. ej. `ZENGUY_FALLBACK_MODEL=gpt-5.6-luna` el día que confirmes el id; hay un test que cubre justo ese override). También puedes apuntar a otro proveedor OpenAI-compatible con `ZENGUY_FALLBACK_MODEL_BASE_URL` (HTTPS obligatorio). El `reasoning_effort` por defecto es `low` (coste/latencia; el objetivo del plan B es que el run se ejecute, no que sea la mejor ejecución posible) y se sube con `ZENGUY_FALLBACK_REASONING_EFFORT=medium` si ves fallos de calidad.

7. **Adaptador nativo, no el de Bionic.** OpenAI sí compila el `json_schema` dinámico de browser-use, así que el fallback usa el `ChatOpenAI` de serie con structured output nativo. El adaptador de texto `BionicChatOpenAI` queda solo para el modo local.

8. **El VPS no tiene credenciales de Cloudflare.** Solo necesita `ZENGUY_RUNNER_TOKEN` (el mismo secret del entorno) y `OPENAI_API_KEY`, por variables de entorno. Menos superficie de ataque que replicar el perfil de Wrangler fuera de casa. En el Mac también puedes guardarlos en `runner/.browser_worker.local.json` (`openai_api_key` + los `*_runner_token` de siempre).

9. **Misma seguridad que el modo local.** SSRF/DNS-check en cada navegación, secretos solo vía `sensitive_data` con ámbito por dominio (nunca en el prompt), screenshots desactivados si el attempt usa secretos, redaction en steps y outcome. La única diferencia consciente: el DOM y las capturas viajan a OpenAI por HTTPS — es el precio explícito del plan B y está forzado a TLS.

10. **Índice nuevo para el poll**: migración `0017_fallback_claim_index.sql` (`test_attempts(status, queued_at)`), porque `claim-stale` se consulta cada pocos segundos.

11. **Trazabilidad**: los runs del fallback quedan registrados con `runnerVersion = zenguy-fallback-runner/2.0.0+browser-use-0.13.8`, `modelName = gpt-5-mini` y delivery ids `fallback-<host>-<uuid>`, así distingues en la UI/BD qué ejecutó cada camino. Desde el 23-08-2026 cada intento guarda además `runner_kind` (`primary` = worker local del Mac, `fallback` = VPS; la API lo infiere del prefijo de `runnerVersion` si un runner antiguo no lo manda) y el desglose de tokens `input_tokens` / `output_tokens` (de `usage.total_prompt_tokens` / `total_completion_tokens` de browser-use; `token_usage` sigue siendo el total), visibles en el detalle del intento, el run y el informe.

## Cómo se comporta en cada escenario

| Escenario | Qué pasa |
| --- | --- |
| Local sano | Local coge todo en <10 s; el fallback poll-ea y recibe `SKIP` siempre. Coste OpenAI: 0. |
| Local lento u ocupado con un run largo | Los demás runs encolados superan los 10 s y el fallback los va ejecutando (también hace de desbordamiento). |
| Local sin internet / sin luz | Todos los runs pasan al fallback ~10-15 s después de encolarse. Los mensajes de la cola quedan ahí; cuando el local vuelve, su claim recibe `SKIP` y ACKea, drenando la cola sin ejecutar nada dos veces. |
| Fallback muere a mitad de un run | Sin lease de cola: el attempt queda `STARTING/RUNNING` y el propio sweep de `claim-stale` (o el cron horario) lo convierte en `WORKER_LOST` ~7-8 min después; el infra-retry lo reencola y cualquiera de los dos workers lo ejecuta. |
| Los dos caídos | Los runs esperan en cola/D1; al volver cualquiera de los dos, todo se drena en orden. |

## Cambios en el código

| Fichero | Cambio |
| --- | --- |
| `apps/api/src/shared/constants.ts` | `FALLBACK_CLAIM_MIN_AGE_MS = 10_000` |
| `apps/api/src/domain/browser_tests/runner_protocol.ts` | `runnerStaleClaimSchema` (`{deliveryId}`) |
| `apps/api/src/domain/browser_tests/repo.ts` + `infrastructure/db/attempt_repo.ts` | `AttemptRepo.listExternallyClaimable(queuedBefore, abandonedBefore, limit)` |
| `apps/api/src/application/execution/external_runner.ts` | `ExternalRunner.claimStale()` (recorre hasta 5 candidatos con el claim de siempre) |
| `apps/api/src/application/execution/attempt_lifecycle.ts` | exporta `WORKER_LOST_GRACE_MS` (sin cambios de lógica) |
| `apps/api/src/http/routes/runner.ts` | ruta `POST /api/runner/attempts/claim-stale` |
| `apps/api/migrations/0017_fallback_claim_index.sql` | índice `(status, queued_at)` |
| `runner/browser_worker.py` | modo `--fallback`: `RunnerConfig.for_fallback`, `AppClient.claim_stale`, `FallbackWorker`, `ChatOpenAI` nativo, HTTPS obligatorio para modelos remotos, `runner_version` propio |
| `runner/deploy/zenguy-fallback.service` | unit de systemd de ejemplo para el VPS |
| `runner/README.md` | sección "Fallback runner (plan B)" |
| Tests | `external_runner.test.ts` (nuevo, 5 casos), `runner.test.ts` (+1), `browser_test_repos.itest.ts` (+1 sobre D1 real), `browser_test_run_routes.itest.ts` (+1 flujo completo con la ventana de 10 s exacta), `test_browser_worker.py` (+10) |

## Cómo activarlo

### Staging (primero)

```bash
# 1. Migración nueva (0017) y deploy de la API con el endpoint
pnpm --filter @zenguy/api exec wrangler d1 migrations apply zenguy-staging-db --remote --env staging --profile zenguy-personal
pnpm --filter @zenguy/api exec wrangler deploy --env staging --profile zenguy-personal

# 2. Smoke con el worker local APAGADO: crea un run de prueba en staging y ~10-15 s después:
ZENGUY_RUNNER_TOKEN=<staging_runner_token> OPENAI_API_KEY=<tu key> \
  ./browser_worker.py --fallback --staging --once
# Debe cogerlo, ejecutarlo con gpt-5-mini y dejar el run PASSED/FAILED con runnerVersion "zenguy-fallback-runner/...".

# 3. Con el worker local ENCENDIDO, repite: el fallback debe quedarse en SKIP (log "fallback_runner_started" y nada más).
```

### VPS (Debian/Ubuntu)

```bash
apt-get install -y python3.11 python3.11-venv chromium
mkdir -p /opt/zenguy && cd /opt/zenguy
# copia el directorio runner/ del repo (no necesita nada más del monorepo)
python3.11 -m venv runner/.venv
runner/.venv/bin/pip install -r runner/requirements.txt

# credenciales (root, 0600)
mkdir -p /etc/zenguy && cat > /etc/zenguy/fallback.env <<'EOF'
ZENGUY_RUNNER_TOKEN=...
OPENAI_API_KEY=...
ZENGUY_FALLBACK_CHROME=/usr/bin/chromium
EOF
chmod 600 /etc/zenguy/fallback.env

cp runner/deploy/zenguy-fallback.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now zenguy-fallback
journalctl -u zenguy-fallback -f   # logs JSON del worker
```

### Producción

**Hecho el 23-08-2026**: migraciones aplicadas, `RUNNER_API_TOKEN` configurado en producción y la unidad `zenguy-fallback` del VPS apuntando a `app.zenguy.com` (la de staging pasó a `zenguy-fallback-staging`). El texto siguiente describe el plan original.

Los mismos tres pasos de staging, **después** de completar los gates de release ya documentados en `BIONIC.md` (producción sigue con las migraciones 0009-0017 pendientes y sin consumidor HTTP en la cola). Ojo: el fallback de producción funciona aunque la cola de producción siga sin consumidor HTTP — le basta con que la API esté desplegada con `claim-stale` y las migraciones aplicadas; de hecho serviría como primer ejecutor de producción si algún día lo quieres así.

## Coste estimado del plan B

Orientativo (precios de gpt-5-mini que conozco: ~0,25 $/M tokens de entrada, ~2 $/M de salida; verifica los vigentes): un attempt de browser-use ronda decenas de miles de tokens, mayormente entrada → **del orden de 0,01-0,10 $ por run**. Y solo se paga cuando el plan B actúa de verdad; en operación normal el coste es cero.

## Validación ejecutada

| Gate | Resultado |
| --- | --- |
| `pnpm --filter @zenguy/api typecheck` | OK |
| `pnpm --filter @zenguy/api test` | 644 tests, 94 ficheros (638 previos + 6 nuevos) |
| `pnpm --filter @zenguy/api test:integration` | 226 tests, 42 ficheros (224 + 2 nuevos, sobre D1 real con la migración 0017 aplicada) |
| `runner: python -m unittest` | 31 tests (21 + 10 nuevos) |
| Smoke CLI | `--help`, error limpio sin credenciales, compilación |

Los tests nuevos cubren específicamente: la frontera exacta de los 10 s (antes `SKIP`, después `EXECUTE`), que el fallback nunca roba un attempt ya cogido, que un claim tardío del local tras el robo legítimo recibe `SKIP`, la recuperación `WORKER_LOST` con su infra-retry reencolado con 30 s de delay, el orden/filtrado/límite de la query en D1 real, y en Python la configuración por entorno, el HTTPS obligatorio, el adaptador nativo y el bucle de poll con delivery ids únicos.

## Límites conocidos / siguientes pasos (no bloqueantes)

- **"Cogido" es cogido**: si el local reclama un run y luego tarda 4 minutos con Bionic frío, el fallback no se lo quita (es el comportamiento que pediste; el timeout de 5 min sigue mandando).
- El fallback ejecuta **en serie** (1 run a la vez), igual que el local. Si necesitas más caudal, arranca N procesos `--fallback`; el claim atómico reparte sin duplicar.
- La recuperación de un fallback muerto tarda ~7-8 min (timeout 5 min + gracia 2 min + poll). Se puede acortar bajando la gracia, pero preferí no tocar la semántica existente de `WORKER_LOST`.
- Queda a tu criterio: alerta/notificación interna cuando el fallback ejecute algo (señal de que el local está caído). Hoy se ve en `runnerVersion` y en los logs del VPS.
- No he desplegado nada ni commiteado (tree con trabajo de otras sesiones). Cuando lo actives en staging, el paso 2 de la checklist es el smoke real de extremo a extremo que falta.
