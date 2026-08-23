# Plan B: worker de respaldo (fallback runner)

**Fecha:** 20 de agosto de 2026
**Estado de seguridad (verificado 23-08-2026):** **los dos servicios remotos deben considerarse en cuarentena.** La inspección del VPS confirmó que `zenguy-fallback` y `zenguy-fallback-staging` siguen ejecutando Python y Chrome directamente en el host desde una revisión antigua, sin contenedor efímero ni `ZENGUY_EGRESS_PROXY`. Esa topología no cumple SEC-01/SEC-12 y no debe aceptar jobs no confiables. Detén las unidades antiguas hasta publicar, verificar y desplegar por digest las dos imágenes descritas en `runner/README.md`; no basta con hacer `git pull` y reiniciar. Los resultados históricos siguientes se conservan como trazabilidad del protocolo, no como evidencia de aislamiento.

## Qué pediste

> El run, una vez elegido por el worker local, se marca como "cogido". Si después de 10 segundos no ha sido cogido, un worker de respaldo en un VPS lo ejecuta con un modelo barato (gpt-5 mini o similar).

## Qué hay ahora

- La marca de **"cogido" ya existía** y la he reutilizado tal cual: el claim del runner transiciona el attempt `QUEUED → STARTING` de forma atómica en D1 y guarda el lease `runner_delivery_id` (migración `0016`). No inventé una segunda marca.
- **Nuevo endpoint** `POST /api/runner/attempts/claim-stale` (token dedicado `RUNNER_FALLBACK_API_TOKEN`): entrega el attempt **más antiguo** que lleve **≥ 10 segundos** reclamable y siga sin coger. Si no hay nada, responde `SKIP`; si entrega trabajo, devuelve una capability de seis minutos ligada a ese worker/attempt.
- **Modo fallback del worker Python**, invocable únicamente por el contenedor Compose firmado con `--fallback --recycle-after-attempt`. Es el mismo ejecutor `browser-use` de siempre, pero:
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

8. **El VPS no tiene credenciales de Queue ni OAuth personal de Cloudflare.** Recibe mediante `LoadCredential` un bootstrap fallback, una clave OpenAI y un Access service token exclusivos de ese runner/entorno. El claim no incluye secretos: se liberan en `start` sólo tras validar la capability por job. El código rechaza ya toda ejecución real directa en el host.

9. **Objetivo de seguridad, no estado remoto actual.** La topología versionada exige proxy de egreso, contenedor efímero y controles CDP en cada intento. El despliegue inspeccionado todavía no usa esa topología; por tanto, ninguna validación histórica del runner demuestra que el VPS esté aislado. Los secretos sólo deben sustituirse sobre HTTPS y con ámbito por dominio, y el DOM/capturas enviados a OpenAI siguen siendo una transferencia explícita a un tercero.

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
pnpm --filter @zenguy/api exec wrangler d1 migrations apply zenguy-staging-db --remote --env staging
pnpm --filter @zenguy/api exec wrangler deploy --env staging

# 2. Publica las imágenes runner-v* desde main, fija en la unidad aislada de
# staging los dos digests firmados, su ZENGUY_RUNNER_RELEASE_TAG y el
# ZENGUY_RUNNER_RELEASE_SHA común de 40 caracteres; después arráncala.
# Con el worker primario APAGADO, crea un run de prueba: debe cogerlo ~10-15 s
# después y dejar runnerVersion "zenguy-fallback-runner/...".

# 3. Con el worker local ENCENDIDO, repite: el fallback debe quedarse en SKIP (log "fallback_runner_started" y nada más).
```

Estos comandos requieren `CLOUDFLARE_API_TOKEN` cargado desde el gestor de
secretos en el entorno del proceso. Usa un token efímero, distinto para staging
y limitado a la operación concreta; no crees ni actives un perfil OAuth personal.

### VPS (Debian/Ubuntu) — procedimiento histórico prohibido

> No uses el procedimiento directo siguiente. Se conserva únicamente para
> explicar el despliegue que debe retirarse. El procedimiento vigente está en
> `runner/README.md`: imagen preconstruida y firmada, referencia por digest,
> verificación con cosign, proxy de egreso y `docker compose run --rm` por job.

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
ZENGUY_EGRESS_PROXY=http://127.0.0.1:3128
ZENGUY_FALLBACK_CHROME=/usr/bin/chromium
EOF
chmod 600 /etc/zenguy/fallback.env

cp runner/deploy/zenguy-fallback.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now zenguy-fallback
journalctl -u zenguy-fallback -f   # logs JSON del worker
```

### Producción — evidencia histórica, no aprobación de seguridad

El 23-08-2026 se verificó que la unidad antigua de producción estaba activa. Eso demuestra disponibilidad histórica, no aislamiento: debe detenerse o reemplazarse por el despliegue firmado y efímero antes de aceptar jobs no confiables. El texto siguiente describe el plan original.

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

## Límites conocidos / siguientes pasos

El reemplazo del despliegue directo por la topología aislada y la rotación de
credenciales son **bloqueantes de seguridad**, no mejoras opcionales.

- **"Cogido" es cogido**: si el local reclama un run y luego tarda 4 minutos con Bionic frío, el fallback no se lo quita (es el comportamiento que pediste; el timeout de 5 min sigue mandando).
- El fallback de referencia ejecuta **en serie** (1 run a la vez). No arranques procesos host ni copias que compartan identidad/credenciales; el escalado horizontal requiere stacks aislados e identidades/tokens separados.
- La recuperación de un fallback muerto tarda ~7-8 min (timeout 5 min + gracia 2 min + poll). Se puede acortar bajando la gracia, pero preferí no tocar la semántica existente de `WORKER_LOST`.
- Queda a tu criterio: alerta/notificación interna cuando el fallback ejecute algo (señal de que el local está caído). Hoy se ve en `runnerVersion` y en los logs del VPS.
- No he desplegado nada ni commiteado (tree con trabajo de otras sesiones). Cuando lo actives en staging, el paso 2 de la checklist es el smoke real de extremo a extremo que falta.
