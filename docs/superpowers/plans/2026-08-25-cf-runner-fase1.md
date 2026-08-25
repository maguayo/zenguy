# Fase 1: Spike del runner en Cloudflare Containers (staging) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ejecutar un run real de staging de extremo a extremo en Cloudflare Containers (contenedor efímero por attempt, disparado por la API), midiendo cold start, duración y coste.

**Architecture:** la API gana un puerto `AttemptDispatch` que, con `RUNNER_DISPATCH=container`, entrega el `AttemptMessage` a un Durable Object `RunnerContainer` (name = attemptId) en vez de a `RUN_QUEUE`. El DO arranca la imagen del runner con el mensaje y las credenciales en `envVars`, programa un watchdog a +8 min, y el contenedor ejecuta UN attempt con el protocolo de claim actual y muere.

**Tech Stack:** TypeScript (Hono + vitest) en `apps/api`, `@cloudflare/containers`, Python 3.12 + browser-use 0.13.8 en `runner/`, wrangler.

**Spec:** `CLOUDFLARE_RUNNER.md` (raíz del repo).

## Global Constraints

- Tests API: `pnpm --filter @zenguy/api test <ruta>` (sin `--`, o corre la suite entera); typecheck: `pnpm --filter @zenguy/api typecheck`.
- Tests runner: `cd runner && .venv/bin/python -m unittest -v test_browser_worker.py`.
- NUNCA `git push` (lo hace Marcos; push a `main` despliega producción, push a `staging` borra y resiembra la D1 de staging). El deploy del spike es `wrangler deploy --env staging` directo, no vía git.
- El tree tiene trabajo sin commitear de otras sesiones: NO tocar ni commitear `runner/browser_worker.py`, `runner/test_browser_worker.py`, `runner/README.md`, `runner/deploy/zenguy-fallback.service`, `BACKUP_RUNNER.md`, `BIONIC.md` hasta pasar la puerta de coordinación de la Tarea 4.
- Commits solo de los ficheros que este plan crea/modifica.
- El bloque `containers` de wrangler exige Docker corriendo al desplegar.
- No degradar ningún guard existente: los modos `queue`/`fallback` no cambian de comportamiento.

---

### Task 1: Puerto `AttemptDispatch` con selección por entorno

**Files:**
- Create: `apps/api/src/application/execution/attempt_dispatch.ts`
- Create: `apps/api/src/application/execution/attempt_dispatch.test.ts`
- Modify: `apps/api/src/index.ts` (los 5 puntos `RUN: env.RUN_QUEUE as Pick<Queue<AttemptMessage>, "send">`, líneas ~371/437/502/556/598) y `apps/api/src/app.ts:330`

**Interfaces:**
- Consumes: `AttemptMessage` (tipo existente), binding `RUN_QUEUE`, binding nuevo `RUNNER_CONTAINER` (Task 2), var `RUNNER_DISPATCH`.
- Produces: `resolveAttemptDispatch(env): Pick<Queue<AttemptMessage>, "send">` — misma forma que ya se inyecta como `RUN`, así el resto de la aplicación no cambia.

- [ ] **Step 1: test que falla**

```ts
// apps/api/src/application/execution/attempt_dispatch.test.ts
import { describe, expect, it, vi } from "vitest";
import { resolveAttemptDispatch } from "./attempt_dispatch";

const message = { attemptId: "att_1" } as never;

describe("resolveAttemptDispatch", () => {
  it("usa la cola cuando RUNNER_DISPATCH no es container", async () => {
    const send = vi.fn();
    const dispatch = resolveAttemptDispatch({
      RUNNER_DISPATCH: "queue",
      RUN_QUEUE: { send },
    } as never);
    await dispatch.send(message);
    expect(send).toHaveBeenCalledWith(message);
  });

  it("entrega al DO RunnerContainer cuando RUNNER_DISPATCH=container", async () => {
    const doFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const getByName = vi.fn(() => ({ fetch: doFetch }));
    const dispatch = resolveAttemptDispatch({
      RUNNER_DISPATCH: "container",
      RUNNER_CONTAINER: { getByName },
    } as never);
    await dispatch.send(message);
    expect(getByName).toHaveBeenCalledWith("att_1");
    const [url, init] = doFetch.mock.calls[0] as never[];
    expect(String(url)).toContain("/dispatch");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(message);
  });

  it("propaga un fallo del DO como error (el caller ya trata errores de enqueue)", async () => {
    const dispatch = resolveAttemptDispatch({
      RUNNER_DISPATCH: "container",
      RUNNER_CONTAINER: {
        getByName: () => ({ fetch: async () => new Response(null, { status: 500 }) }),
      },
    } as never);
    await expect(dispatch.send(message)).rejects.toThrow();
  });
});
```

- [ ] **Step 2:** `pnpm --filter @zenguy/api test src/application/execution/attempt_dispatch.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: implementación mínima**

```ts
// apps/api/src/application/execution/attempt_dispatch.ts
import type { AttemptMessage } from "../../domain/browser_tests/runner_protocol";

type DispatchEnv = {
  RUNNER_DISPATCH?: string;
  RUN_QUEUE: Pick<Queue<AttemptMessage>, "send">;
  RUNNER_CONTAINER?: {
    getByName(name: string): { fetch(url: string, init?: RequestInit): Promise<Response> };
  };
};

export function resolveAttemptDispatch(
  env: DispatchEnv,
): Pick<Queue<AttemptMessage>, "send"> {
  if (env.RUNNER_DISPATCH !== "container") {
    return { send: (message) => env.RUN_QUEUE.send(message) };
  }
  const containers = env.RUNNER_CONTAINER;
  if (containers === undefined) {
    throw new Error("RUNNER_DISPATCH=container requiere el binding RUNNER_CONTAINER");
  }
  return {
    send: async (message) => {
      const stub = containers.getByName(message.attemptId);
      const response = await stub.fetch("http://runner-container/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
      if (!response.ok) {
        throw new Error(`RunnerContainer dispatch failed with ${response.status}`);
      }
    },
  };
}
```

Nota: ajusta la ruta del import de `AttemptMessage` a la real (está en `src/domain/browser_tests/runner_protocol.ts`; verificar el export exacto con `grep -n "AttemptMessage" apps/api/src/domain/browser_tests/runner_protocol.ts`).

- [ ] **Step 4:** mismo comando de test → PASS.

- [ ] **Step 5: sustituir las inyecciones.** En `apps/api/src/index.ts` y `apps/api/src/app.ts`, cambiar cada
`RUN: env.RUN_QUEUE as Pick<Queue<AttemptMessage>, "send">` por `RUN: resolveAttemptDispatch(env)` (import nuevo). `pnpm --filter @zenguy/api typecheck` y la suite del fichero `src/app.test.ts` si existe → PASS. Con `RUNNER_DISPATCH` sin definir el comportamiento es idéntico al actual (queue), así que ningún test existente debe cambiar.

- [ ] **Step 6: commit**

```bash
git add apps/api/src/application/execution/attempt_dispatch.ts apps/api/src/application/execution/attempt_dispatch.test.ts apps/api/src/index.ts apps/api/src/app.ts
git commit -m "api: puerto AttemptDispatch con selección queue/container"
```

---

### Task 2: Durable Object `RunnerContainer` + config wrangler de staging

**Files:**
- Create: `apps/api/src/infrastructure/containers/runner_container.ts`
- Create: `apps/api/src/infrastructure/containers/runner_container.test.ts`
- Modify: `apps/api/wrangler.jsonc` (solo el bloque `env.staging`), `apps/api/package.json` (+ `@cloudflare/containers`), `apps/api/src/index.ts` (export de la clase)

**Interfaces:**
- Consumes: `POST /dispatch` con `AttemptMessage` (Task 1); secrets `RUNNER_CF_API_TOKEN`, `OPENAI_API_KEY_CF`, `RUNNER_CF_ACCESS_CLIENT_ID`, `RUNNER_CF_ACCESS_CLIENT_SECRET`; vars `RUNNER_ENVIRONMENT`, `PUBLIC_API_URL`.
- Produces: la clase exportada `RunnerContainer` (binding DO `RUNNER_CONTAINER`) que arranca el contenedor con los `envVars` que consume la Tarea 4.

- [ ] **Step 1:** `pnpm --filter @zenguy/api add @cloudflare/containers` y confirmar la API real de la versión instalada en `node_modules/@cloudflare/containers/README.md`: nombres exactos de `start({ envVars })`, `schedule()`, `alarm()`/callback de schedule y `entrypoint`. Si difieren del sketch de abajo, manda el README instalado.

- [ ] **Step 2: test que falla** (unidad sobre la lógica de dispatch del DO; el ciclo de vida real del contenedor se prueba en staging en la Tarea 5)

```ts
// apps/api/src/infrastructure/containers/runner_container.test.ts
import { describe, expect, it, vi } from "vitest";
import { buildRunnerEnvVars } from "./runner_container";

describe("buildRunnerEnvVars", () => {
  const env = {
    RUNNER_ENVIRONMENT: "staging",
    PUBLIC_API_URL: "https://staging-app.zenguy.com",
    RUNNER_CF_API_TOKEN: "t".repeat(48),
    OPENAI_API_KEY_CF: "sk-test",
    RUNNER_CF_ACCESS_CLIENT_ID: "c".repeat(32),
    RUNNER_CF_ACCESS_CLIENT_SECRET: "s".repeat(48),
  } as never;

  it("compone el entorno one-shot del contenedor", () => {
    const vars = buildRunnerEnvVars(env, { attemptId: "att_1" } as never, "cf-abc");
    expect(vars.ZENGUY_ISOLATED_RUNNER).toBe("cloudflare");
    expect(vars.ZENGUY_WORKER_ID).toBe("zenguy-staging-cf");
    expect(vars.ZENGUY_API_URL).toBe("https://staging-app.zenguy.com");
    expect(vars.ZENGUY_DELIVERY_ID).toBe("cf-abc");
    expect(JSON.parse(vars.ZENGUY_ATTEMPT_MESSAGE).attemptId).toBe("att_1");
    expect(vars.ZENGUY_RUNNER_TOKEN).toBe(env.RUNNER_CF_API_TOKEN);
  });

  it("rechaza un entorno sin secretos", () => {
    expect(() =>
      buildRunnerEnvVars({ ...env, RUNNER_CF_API_TOKEN: "" } as never, { attemptId: "a" } as never, "d"),
    ).toThrow();
  });
});
```

- [ ] **Step 3:** correr el test → FAIL. Implementar:

```ts
// apps/api/src/infrastructure/containers/runner_container.ts
import { Container } from "@cloudflare/containers";
import type { AttemptMessage } from "../../domain/browser_tests/runner_protocol";

type RunnerEnv = {
  RUNNER_ENVIRONMENT: string;
  PUBLIC_API_URL: string;
  RUNNER_CF_API_TOKEN: string;
  OPENAI_API_KEY_CF: string;
  RUNNER_CF_ACCESS_CLIENT_ID: string;
  RUNNER_CF_ACCESS_CLIENT_SECRET: string;
};

const WATCHDOG_DELAY_MS = 8 * 60_000;

export function buildRunnerEnvVars(
  env: RunnerEnv,
  message: AttemptMessage,
  deliveryId: string,
): Record<string, string> {
  if (
    !env.RUNNER_CF_API_TOKEN ||
    !env.OPENAI_API_KEY_CF ||
    !env.RUNNER_CF_ACCESS_CLIENT_ID ||
    !env.RUNNER_CF_ACCESS_CLIENT_SECRET
  ) {
    throw new Error("RunnerContainer requiere sus cuatro secretos en el Worker");
  }
  return {
    ZENGUY_ISOLATED_RUNNER: "cloudflare",
    ZENGUY_RUNNER_ENVIRONMENT: env.RUNNER_ENVIRONMENT,
    ZENGUY_WORKER_ID: `zenguy-${env.RUNNER_ENVIRONMENT}-cf`,
    ZENGUY_API_URL: env.PUBLIC_API_URL,
    ZENGUY_ATTEMPT_MESSAGE: JSON.stringify(message),
    ZENGUY_DELIVERY_ID: deliveryId,
    ZENGUY_RUNNER_TOKEN: env.RUNNER_CF_API_TOKEN,
    OPENAI_API_KEY: env.OPENAI_API_KEY_CF,
    CF_ACCESS_CLIENT_ID: env.RUNNER_CF_ACCESS_CLIENT_ID,
    CF_ACCESS_CLIENT_SECRET: env.RUNNER_CF_ACCESS_CLIENT_SECRET,
  };
}

export class RunnerContainer extends Container<RunnerEnv> {
  sleepAfter = "10m";
  enableInternet = true;
  entrypoint = ["python", "/opt/zenguy/runner/browser_worker.py", "--cloudflare"];

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/dispatch") {
      return new Response("not found", { status: 404 });
    }
    const message = (await request.json()) as AttemptMessage;
    await this.start({
      envVars: buildRunnerEnvVars(this.env, message, `cf-${crypto.randomUUID()}`),
    });
    await this.schedule(Date.now() + WATCHDOG_DELAY_MS);
    return Response.json({ dispatched: true });
  }

  override async alarm(): Promise<void> {
    // Watchdog: mismo camino de recuperación que el cron horario. Localizar la
    // función que usa el handler `scheduled` de src/index.ts (grep "scheduled")
    // y ejecutarla aquí con this.env; convierte un contenedor muerto en
    // WORKER_LOST + retry en ~8 min en vez de esperar al cron.
  }
}
```

El cuerpo de `alarm()` se completa en esta misma tarea: paso obligatorio, leer el handler `scheduled` de `apps/api/src/index.ts`, extraer la función de recuperación que ya existe y llamarla; añadir un test que verifique que `alarm()` la invoca (spy). Si la extracción exige refactor grande, la alternativa aceptada es reusar el endpoint interno que dispare esa recuperación. Prohibido dejar `alarm()` vacío al commitear.

- [ ] **Step 4:** exportar `RunnerContainer` desde `apps/api/src/index.ts` (los DO se exportan desde el entry). Config de `wrangler.jsonc`, SOLO en `env.staging`:

```jsonc
"containers": [
  {
    "class_name": "RunnerContainer",
    "image": "../../runner/deploy/Dockerfile",
    "instance_type": "standard-2",
    "max_instances": 5
  }
],
// dentro de durable_objects.bindings de staging:
{ "name": "RUNNER_CONTAINER", "class_name": "RunnerContainer" },
// migración nueva:
{ "tag": "vN", "new_sqlite_classes": ["RunnerContainer"] },
// vars de staging:
"RUNNER_DISPATCH": "container", "RUNNER_ENVIRONMENT": "staging", "PUBLIC_API_URL": "https://staging-app.zenguy.com"
```

Verificar con `pnpm --filter @zenguy/api exec wrangler deploy --dry-run --env staging` (con Docker apagado el build de imagen puede quejarse: se acepta validar solo la sintaxis del config; el build real es de la Tarea 5). Ojo: el Dockerfile copia `runner/` — comprobar que el build context (`../../runner`) y sus `.dockerignore` de allowlist siguen dejando fuera `.venv` y credenciales locales.

- [ ] **Step 5:** `pnpm --filter @zenguy/api typecheck` y `pnpm --filter @zenguy/api test src/infrastructure/containers/runner_container.test.ts` → PASS. Revisar que `src/wrangler_config.test.ts` (valida el config) pasa; si asserta la lista de bindings, añadir los nuevos.

- [ ] **Step 6: commit**

```bash
git add apps/api/src/infrastructure/containers/ apps/api/wrangler.jsonc apps/api/package.json pnpm-lock.yaml apps/api/src/index.ts
git commit -m "api: RunnerContainer DO y config de containers en staging"
```

---

### Task 3: Tercer modo de identidad de runner (`cf`) en la API

**Files:**
- Modify: `apps/api/src/shared/config.ts` (secret `RUNNER_CF_API_TOKEN`), `apps/api/src/http/routes/runner.ts` (funciones `requireWorkerIdentity`/resolución de token, líneas ~68-160)
- Test: ampliar `apps/api/src/http/routes/runner.test.ts`

**Interfaces:**
- Consumes: convención de identidad existente `zenguy-<environment>-<modo>`.
- Produces: bearer `RUNNER_CF_API_TOKEN` autoriza claim/steps bootstrap/heartbeat con `workerId = zenguy-<env>-cf` y modo `"cf"`; los tokens `local`/`fallback` NO valen para esa identidad ni viceversa.

- [ ] **Step 1: tests que fallan** (siguiendo el patrón exacto de los casos `fallback` ya presentes en `runner.test.ts` — copiar un caso de claim con token fallback y derivar):
  1. claim con `RUNNER_CF_API_TOKEN` + `X-Zenguy-Worker-Id: zenguy-staging-cf` → `EXECUTE`/`SKIP` (autoriza);
  2. claim con `RUNNER_CF_API_TOKEN` + identidad `zenguy-staging-fallback` → rechazado;
  3. claim con `RUNNER_FALLBACK_API_TOKEN` + identidad `zenguy-staging-cf` → rechazado;
  4. heartbeat con modo `cf` → aceptado y visible con su `workerId`.
- [ ] **Step 2:** correr `pnpm --filter @zenguy/api test src/http/routes/runner.test.ts` → FAIL.
- [ ] **Step 3:** implementar: en `config.ts` añadir `RUNNER_CF_API_TOKEN` junto a los otros dos tokens (misma validación de longitud); en `runner.ts` extender el mapa token→modo con `"cf"` y `requireWorkerIdentity(workerId, "cf")` esperando `zenguy-${environment}-cf`. El endpoint de claim que usa el contenedor es el `POST /attempts/claim` existente (línea ~127): cambiar su `requireWorkerIdentity(input.workerId, "local")` por la aceptación de `local` O `cf` según el token presentado — el modo se deriva del token, nunca del payload.
- [ ] **Step 4:** tests + `pnpm --filter @zenguy/api typecheck` → PASS. Correr también la suite completa de la API (`pnpm --filter @zenguy/api test`) porque config.ts es transversal.
- [ ] **Step 5: commit**

```bash
git add apps/api/src/shared/config.ts apps/api/src/http/routes/runner.ts apps/api/src/http/routes/runner.test.ts
git commit -m "api: identidad y token dedicados para el runner de Cloudflare (modo cf)"
```

---

### Task 4: Modo `--cloudflare` del worker Python ⛔ PUERTA DE COORDINACIÓN

**Antes de tocar nada:** `runner/browser_worker.py` y `runner/test_browser_worker.py` tienen cambios sin commitear de otra sesión (ver `git status`). Enviar `SendMessage` a las sesiones zenguy activas (p. ej. `zenguy-81`, `zenguy-03`) preguntando de quién son y esperar a que los commiteen; solo entonces continuar sobre el fichero actualizado. Si nadie los reclama en el plazo que Marcos decida, escalar a Marcos — no pisar el trabajo.

**Files:**
- Modify: `runner/browser_worker.py`, `runner/test_browser_worker.py`

**Interfaces:**
- Consumes: los `envVars` exactos que produce `buildRunnerEnvVars` (Task 2).
- Produces: `RunnerConfig.for_cloudflare(environ)`, `assert_cloudflare_runtime(environ)`, clase `CloudflareWorker.run_once()` y el flag CLI `--cloudflare`; `runner_version` = `zenguy-cf-runner/2.2.0+browser-use-0.13.8`, `runner_kind` = `"cf"`.

- [ ] **Step 1: tests que fallan** (mismo estilo unittest del fichero; añadir clase `CloudflareModeTest`):

```python
def _cf_environ(**overrides):
    base = {
        "ZENGUY_ISOLATED_RUNNER": "cloudflare",
        "CLOUDFLARE_DURABLE_OBJECT_ID": "do-123",
        "ZENGUY_RUNNER_ENVIRONMENT": "staging",
        "ZENGUY_WORKER_ID": "zenguy-staging-cf",
        "ZENGUY_API_URL": "https://staging-app.zenguy.com",
        "ZENGUY_ATTEMPT_MESSAGE": json.dumps({"attemptId": "att_1"}),
        "ZENGUY_DELIVERY_ID": "cf-abc",
        "ZENGUY_RUNNER_TOKEN": "t" * 48,
        "OPENAI_API_KEY": "sk-test",
        "CF_ACCESS_CLIENT_ID": "c" * 32,
        "CF_ACCESS_CLIENT_SECRET": "s" * 48,
    }
    base.update(overrides)
    return base

class CloudflareModeTest(unittest.TestCase):
    def test_runtime_gate_requires_do_id(self):
        env = _cf_environ()
        env.pop("CLOUDFLARE_DURABLE_OBJECT_ID")
        with self.assertRaises(browser_worker.ConfigError):
            browser_worker.assert_cloudflare_runtime(environ=env, uid=10001, effective_uid=10001, platform="linux")

    def test_runtime_gate_requires_uid_10001(self):
        with self.assertRaises(browser_worker.ConfigError):
            browser_worker.assert_cloudflare_runtime(environ=_cf_environ(), uid=0, effective_uid=0, platform="linux")

    def test_config_reads_message_and_optional_proxy(self):
        config = browser_worker.RunnerConfig.for_cloudflare(environ=_cf_environ())
        self.assertEqual(config.mode, "cloudflare")
        self.assertEqual(config.runner_kind, "cf")
        self.assertEqual(config.worker_id, "zenguy-staging-cf")
        self.assertIsNone(config.egress_proxy)  # opcional SOLO en este modo

    def test_config_rejects_wrong_identity(self):
        with self.assertRaises(browser_worker.ConfigError):
            browser_worker.RunnerConfig.for_cloudflare(
                environ=_cf_environ(ZENGUY_WORKER_ID="zenguy-staging-fallback")
            )
```

Más un test del bucle one-shot con `AppClient` mockeado (patrón de los tests de `FallbackWorker` existentes): claim → execute → exit; claim `SKIP` → exit sin ejecutar.

- [ ] **Step 2:** `cd runner && .venv/bin/python -m unittest -v test_browser_worker.py -k Cloudflare` → FAIL.
- [ ] **Step 3:** implementar en `browser_worker.py`:
  - `assert_cloudflare_runtime(environ, uid, effective_uid, platform)`: linux + uid/euid 10001 + `ZENGUY_ISOLATED_RUNNER == "cloudflare"` + `CLOUDFLARE_DURABLE_OBJECT_ID` no vacío; falla con `ConfigError`.
  - `RunnerConfig.for_cloudflare(environ)`: calcado de `for_fallback` pero mensaje/delivery desde env, `mode="cloudflare"`, `runner_kind="cf"`, `egress_proxy` opcional (si viene, se valida igual), identidad estricta `zenguy-<env>-cf`, `runner_version = "zenguy-cf-runner/…"`, mismos requisitos de token/Access/OpenAI.
  - `CloudflareWorker.run_once()`: parsea `ZENGUY_ATTEMPT_MESSAGE`, llama a `AppClient.claim(delivery_id, message)`, ejecuta con el executor existente, `sys.exit(0)` siempre que el protocolo concluya (SKIP incluido); errores fatales → exit ≠ 0 (el watchdog del DO cubre la recuperación).
  - CLI: flag `--cloudflare` excluyente con `--fallback`; `scrub_sensitive_runner_environment()` se ejecuta igual antes de lanzar Chromium.
- [ ] **Step 4:** suite completa del runner (`.venv/bin/python -m unittest -v test_browser_worker.py`) → PASS, incluidos los tests previos de otros modos.
- [ ] **Step 5: commit** (coordinado: solo después de que la otra sesión haya commiteado lo suyo)

```bash
git add runner/browser_worker.py runner/test_browser_worker.py
git commit -m "runner: modo one-shot --cloudflare para Cloudflare Containers"
```

---

### Task 5: Deploy de staging y smoke E2E (manual — la ejecuta Marcos)

Prerrequisitos: Tasks 1-4 commiteadas, Docker corriendo en el Mac.

- [ ] **Step 1: secretos de staging** (valores nuevos, no reutilizar los del VPS):

```bash
pnpm --filter @zenguy/api exec wrangler secret put RUNNER_CF_API_TOKEN --env staging
pnpm --filter @zenguy/api exec wrangler secret put OPENAI_API_KEY_CF --env staging
pnpm --filter @zenguy/api exec wrangler secret put RUNNER_CF_ACCESS_CLIENT_ID --env staging
pnpm --filter @zenguy/api exec wrangler secret put RUNNER_CF_ACCESS_CLIENT_SECRET --env staging
```

(el par de Access se crea antes en el dashboard de Cloudflare Zero Trust, dedicado a `zenguy-staging-cf`).

- [ ] **Step 2: deploy** `pnpm --filter @zenguy/api exec wrangler deploy --env staging` (construye y sube la imagen; primera vez tarda minutos).
- [ ] **Step 3: parar la unidad staging del VPS** para que no compita: `ssh root@142.132.220.44 systemctl stop zenguy-fallback-staging` (solo stop, no disable: es reversible hasta F3).
- [ ] **Step 4: smoke.** Con el worker del Mac APAGADO, crear un run de staging desde la UI. Verificar en `wrangler tail --env staging` y en el admin: attempt reclamado por `zenguy-staging-cf`, `runnerVersion` `zenguy-cf-runner/…`, resultado `PASSED`.
- [ ] **Step 5: medir y anotar en `CLOUDFLARE_RUNNER.md`:** cold start (delta entre el log de dispatch del DO y el claim del contenedor), duración total vs mediana 69 s, coste del run en el dashboard de Containers.
- [ ] **Step 6: probar el watchdog:** crear otro run y, a mitad, matar el contenedor (`pnpm --filter @zenguy/api exec wrangler containers list` + terminate desde el dashboard). Esperar ~8 min: el attempt debe pasar a `WORKER_LOST` y reintentarse solo.
- [ ] **Step 7: criterios de salida de F1** (todos): E2E `PASSED`; cold start ≤ 5 s; regresión de duración ≤ 20 %; watchdog recupera; coste/run medido ≈ estimado. Si algo falla, se anota en el spec y se decide antes de F2.
