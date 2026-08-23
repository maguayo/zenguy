# Zenguy Admin (admin.zenguy.com) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montar el panel interno `admin.zenguy.com` (solo lectura, producción) más el heartbeat/identidad de los workers del runner que el panel necesita.

**Architecture:** Tres piezas: (A) `apps/api` gana la tabla `runner_workers`, el endpoint `POST /api/runner/heartbeat` y persiste `workerId` en los claims; (B) `runner/browser_worker.py` emite heartbeats cada 5 s y envía `workerId`; (C+D) `apps/admin` es un Worker nuevo (`zenguy-admin`) con API Hono en `/api/*` y SPA React servida con Workers Assets, enlazado en solo-lectura a la D1 de producción (`zenguy-db`), con login delegado a `https://api.zenguy.com/api/auth/login` + allowlist `ADMIN_EMAILS`.

**Tech Stack:** Cloudflare Workers + Workers Assets, Hono 4, zod 4, D1, `@cloudflare/vitest-pool-workers`, React 19 + Vite 8 + Tailwind 4 + `@tanstack/react-query` 5, Python 3.12 `unittest`.

**Spec:** `docs/superpowers/specs/2026-08-21-admin-dashboard-design.md`

## Global Constraints

- Premisas del spec que han cambiado desde el 21/08 (verificado el 23/08):
  - `0018` ya existe (`0018_free_launch_plan.sql`); la migración nueva es **`0023_runner_workers.sql`** (la `0022` está en vuelo de otra sesión).
  - La D1 de producción ya tiene aplicadas `0001`–`0021` y `api.zenguy.com` está activa: el login delegado funciona desde el día 1. La degradación `MIGRATION_PENDING` sigue siendo necesaria hasta que `0023` llegue a producción (CI en push a `main`).
- Umbral online: `RUNNER_ONLINE_THRESHOLD_MS = 15_000` (3 heartbeats perdidos). Canónico en `apps/api/src/shared/constants.ts`, replicado y documentado con test en `apps/admin`.
- `workerId` siempre valida contra `^[A-Za-z0-9._-]{1,64}$`.
- Heartbeat del worker Python: cada **5 s**, `POST /api/runner/heartbeat` con `{ workerId, mode: "local"|"fallback", version, startedAt }`.
- Cookie admin: `zenguy_admin_session`, HttpOnly, Secure, SameSite=Lax, Path=/, 7 días, contenido `base64url(payload).base64url(HMAC-SHA256)`. Verificación timing-safe.
- El Worker admin **solo ejecuta SELECT** contra D1 y nunca selecciona `password_hash`, `token_hash`, `encrypted_*`, ni secrets.
- Respuestas de la API admin con forma `{ data: ... }` (errores `{ error: { code, message } }`) y `Cache-Control: no-store`.
- Copy de UI en inglés (como el resto del producto). Estilo visual: reglas de `apps/frontend/src/styles/index.css` (cards `bg-white border border-zinc-200 rounded-lg`, acento indigo, fuentes Inter / IBM Plex Mono).
- Monorepo pnpm: `pnpm add`, nunca `npm install`. Commits solo de rutas propias (`apps/admin/**`, `apps/api/migrations/0023_*`, los ficheros de `apps/api/src` listados en cada tarea, `runner/*`). `apps/api/src/app.ts` lo tiene modificado otra sesión: editar mínimamente y commitear solo el hunk propio.
- Nunca `git push` (producción se despliega con push a `main`; se le pasa el comando a Marcos).

---

## Parte A — `apps/api`: protocolo runner (heartbeat + identidad)

### Task A1: Migración `0023_runner_workers.sql` y constante canónica

**Files:**
- Create: `apps/api/migrations/0023_runner_workers.sql`
- Modify: `apps/api/src/shared/constants.ts` (añadir 2 líneas tras `FALLBACK_CLAIM_MIN_AGE_MS`)

**Interfaces:**
- Produces: tabla `runner_workers(id, mode, version, started_at, first_seen_at, last_seen_at)`, columna `test_attempts.claimed_by_runner_id TEXT`, constante `RUNNER_ONLINE_THRESHOLD_MS`.

- [ ] **Step 1: Crear la migración**

```sql
-- External runner workers (runner/browser_worker.py) report a heartbeat every
-- few seconds so the admin panel can show which executors are online, and
-- every claim records which worker took the attempt.
CREATE TABLE runner_workers (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('local','fallback')),
  version TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

ALTER TABLE test_attempts ADD COLUMN claimed_by_runner_id TEXT;
```

- [ ] **Step 2: Añadir la constante**

En `apps/api/src/shared/constants.ts`, justo después de `FALLBACK_CLAIM_MIN_AGE_MS`:

```ts
// A runner worker that has not sent a heartbeat for this long is shown as
// offline (3 missed 5-second heartbeats). apps/admin replicates this value.
export const RUNNER_ONLINE_THRESHOLD_MS = 15_000;
```

- [ ] **Step 3: Verificar que la migración aplica en local y en los tests**

Run: `cd apps/api && pnpm db:migrate:local` → debe listar `0023_runner_workers.sql` aplicada (o "No migrations to apply" si ya lo estaba).
Run: `pnpm --filter @zenguy/api test:integration -- src/infrastructure/db/d1.itest.ts` → PASS (las migraciones se aplican en `src/test/apply-migrations.ts`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/migrations/0023_runner_workers.sql apps/api/src/shared/constants.ts
git commit -m "api: runner_workers table and claimed_by_runner_id column (0023)"
```

### Task A2: Dominio `runners` + `D1RunnerWorkerRepo`

**Files:**
- Create: `apps/api/src/domain/runners/types.ts`
- Create: `apps/api/src/domain/runners/repo.ts`
- Create: `apps/api/src/infrastructure/db/runner_worker_repo.ts`
- Test: `apps/api/src/infrastructure/db/runner_worker_repo.itest.ts`
- Create: `apps/api/src/test/fakes/runners.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RunnerWorkerMode = "local" | "fallback";
  export interface RunnerHeartbeat { workerId: string; mode: RunnerWorkerMode; version: string; startedAt: number; }
  export interface RunnerWorker { id: string; mode: RunnerWorkerMode; version: string; startedAt: number; firstSeenAt: number; lastSeenAt: number; }
  export interface RunnerWorkerRepo { recordHeartbeat(heartbeat: RunnerHeartbeat, seenAt: number): Promise<void>; findById(id: string): Promise<RunnerWorker | null>; }
  ```

- [ ] **Step 1: Tipos y contrato del repo**

`apps/api/src/domain/runners/types.ts`:
```ts
export type RunnerWorkerMode = "local" | "fallback";

export interface RunnerHeartbeat {
  workerId: string;
  mode: RunnerWorkerMode;
  version: string;
  startedAt: number;
}

export interface RunnerWorker {
  id: string;
  mode: RunnerWorkerMode;
  version: string;
  startedAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
}
```

`apps/api/src/domain/runners/repo.ts`:
```ts
import type { RunnerHeartbeat, RunnerWorker } from "./types";

export interface RunnerWorkerRepo {
  /** UPSERT: inserts on first contact, otherwise refreshes mode/version/started_at/last_seen_at. */
  recordHeartbeat(heartbeat: RunnerHeartbeat, seenAt: number): Promise<void>;
  findById(id: string): Promise<RunnerWorker | null>;
}
```

- [ ] **Step 2: Test de integración (falla primero)**

`apps/api/src/infrastructure/db/runner_worker_repo.itest.ts`:
```ts
import { env } from "cloudflare:test";
import { D1RunnerWorkerRepo } from "./runner_worker_repo";

describe("D1RunnerWorkerRepo", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM runner_workers").run();
  });

  it("inserts on the first heartbeat and keeps first_seen_at on later ones", async () => {
    const repo = new D1RunnerWorkerRepo(env.DB);
    await repo.recordHeartbeat(
      { workerId: "mac-marcos", mode: "local", version: "zenguy-local-runner/2.0.0", startedAt: 900 },
      1_000,
    );
    await repo.recordHeartbeat(
      { workerId: "mac-marcos", mode: "local", version: "zenguy-local-runner/2.0.1", startedAt: 950 },
      6_000,
    );

    await expect(repo.findById("mac-marcos")).resolves.toEqual({
      id: "mac-marcos",
      mode: "local",
      version: "zenguy-local-runner/2.0.1",
      startedAt: 950,
      firstSeenAt: 1_000,
      lastSeenAt: 6_000,
    });
  });

  it("returns null for unknown workers", async () => {
    await expect(new D1RunnerWorkerRepo(env.DB).findById("nope")).resolves.toBeNull();
  });
});
```

Run: `cd apps/api && pnpm test:integration -- src/infrastructure/db/runner_worker_repo.itest.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación D1**

`apps/api/src/infrastructure/db/runner_worker_repo.ts`:
```ts
import type { RunnerWorkerRepo } from "../../domain/runners/repo";
import type {
  RunnerHeartbeat,
  RunnerWorker,
  RunnerWorkerMode,
} from "../../domain/runners/types";
import { one, run } from "./d1";

interface RunnerWorkerRow {
  id: string;
  mode: RunnerWorkerMode;
  version: string;
  started_at: number;
  first_seen_at: number;
  last_seen_at: number;
}

export class D1RunnerWorkerRepo implements RunnerWorkerRepo {
  constructor(private readonly database: D1Database) {}

  async recordHeartbeat(heartbeat: RunnerHeartbeat, seenAt: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO runner_workers
             (id, mode, version, started_at, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             mode = excluded.mode,
             version = excluded.version,
             started_at = excluded.started_at,
             last_seen_at = excluded.last_seen_at`,
        )
        .bind(
          heartbeat.workerId,
          heartbeat.mode,
          heartbeat.version,
          heartbeat.startedAt,
          seenAt,
          seenAt,
        ),
    );
  }

  async findById(id: string): Promise<RunnerWorker | null> {
    const row = await one<RunnerWorkerRow>(
      this.database.prepare("SELECT * FROM runner_workers WHERE id = ?").bind(id),
    );
    return row === null
      ? null
      : {
          id: row.id,
          mode: row.mode,
          version: row.version,
          startedAt: row.started_at,
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
        };
  }
}
```

Fake en memoria `apps/api/src/test/fakes/runners.ts` (para los tests de ruta):
```ts
import type { RunnerWorkerRepo } from "../../domain/runners/repo";
import type { RunnerHeartbeat, RunnerWorker } from "../../domain/runners/types";

export class FakeRunnerWorkerRepo implements RunnerWorkerRepo {
  readonly workers = new Map<string, RunnerWorker>();

  async recordHeartbeat(heartbeat: RunnerHeartbeat, seenAt: number): Promise<void> {
    const existing = this.workers.get(heartbeat.workerId);
    this.workers.set(heartbeat.workerId, {
      id: heartbeat.workerId,
      mode: heartbeat.mode,
      version: heartbeat.version,
      startedAt: heartbeat.startedAt,
      firstSeenAt: existing?.firstSeenAt ?? seenAt,
      lastSeenAt: seenAt,
    });
  }

  async findById(id: string): Promise<RunnerWorker | null> {
    return this.workers.get(id) ?? null;
  }
}
```

- [ ] **Step 4: Verificar**

Run: `cd apps/api && pnpm test:integration -- src/infrastructure/db/runner_worker_repo.itest.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/domain/runners apps/api/src/infrastructure/db/runner_worker_repo.ts apps/api/src/infrastructure/db/runner_worker_repo.itest.ts apps/api/src/test/fakes/runners.ts
git commit -m "api: runner worker heartbeat repository"
```

### Task A3: Protocolo — `workerId` opcional en claims y schema de heartbeat

**Files:**
- Modify: `apps/api/src/domain/browser_tests/runner_protocol.ts`

**Interfaces:**
- Produces: `runnerWorkerIdSchema`, `runnerHeartbeatSchema`, `RunnerHeartbeatInput`; `runnerClaimSchema`/`runnerStaleClaimSchema` aceptan `workerId?: string`.

- [ ] **Step 1: Editar el protocolo**

Tras `runnerDeliveryIdSchema`:
```ts
export const runnerWorkerIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/u, "Worker id must be 1-64 chars of [A-Za-z0-9._-]");
```

Cambiar los dos schemas de claim:
```ts
export const runnerClaimSchema = z
  .object({
    deliveryId: runnerDeliveryIdSchema,
    message: attemptMessageSchema,
    workerId: runnerWorkerIdSchema.optional(),
  })
  .strict();

export const runnerStaleClaimSchema = z
  .object({
    deliveryId: runnerDeliveryIdSchema,
    workerId: runnerWorkerIdSchema.optional(),
  })
  .strict();
```

Añadir al final (antes de los `export type`):
```ts
export const runnerHeartbeatSchema = z
  .object({
    workerId: runnerWorkerIdSchema,
    mode: z.enum(["local", "fallback"]),
    version: z.string().min(1).max(200),
    startedAt: z.number().int().nonnegative(),
  })
  .strict();

export type RunnerHeartbeatInput = z.infer<typeof runnerHeartbeatSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @zenguy/api typecheck` → PASS (los campos son opcionales; nada consume aún `workerId`).

- [ ] **Step 3: Commit** (junto con A4, ver abajo)

### Task A4: El claim persiste `claimed_by_runner_id`

**Files:**
- Modify: `apps/api/src/domain/browser_tests/repo.ts` (firma `claimQueued`)
- Modify: `apps/api/src/infrastructure/db/attempt_repo.ts` (`claimQueued`, `resetForInfraRetry`)
- Modify: `apps/api/src/test/fakes/browser_test_repos.ts` (`claimQueued` del fake)
- Modify: `apps/api/src/application/execution/attempt_lifecycle.ts` (`claim` firma y paso del id)
- Modify: `apps/api/src/application/execution/external_runner.ts` (`claim`, `claimStale`)
- Test: `apps/api/src/infrastructure/db/browser_test_repos.itest.ts` (añadir 1 test)
- Test: `apps/api/src/http/routes/runner.test.ts` (assert de `claim` con `workerId`)

**Interfaces:**
- `AttemptRepo.claimQueued(id: string, claimedAt: number, runnerDeliveryId?: string, claimedByRunnerId?: string): Promise<boolean>`
- `AttemptLifecycle.claim(message: AttemptMessage, runnerDeliveryId?: string, claimedByRunnerId?: string): Promise<"execute" | "skip">`
- `ExternalRunner.claimStale(input: { deliveryId: string; workerId?: string })`

- [ ] **Step 1: Test de integración del repo (falla primero)**

Añadir a `apps/api/src/infrastructure/db/browser_test_repos.itest.ts`, dentro del `describe` del attempt repo existente (buscar el test de `claimQueued` y copiar su fixture para insertar un run + attempt QUEUED):
```ts
it("records which runner worker claimed the attempt", async () => {
  // usa el mismo helper/fixture que el test de claimQueued vecino para
  // insertar un attempt QUEUED con id "att_claim_worker" y queued_at 1_000
  const repo = new D1AttemptRepo(env.DB);
  expect(await repo.claimQueued("att_claim_worker", 2_000, "delivery-1", "vps-fallback")).toBe(true);
  const row = await env.DB
    .prepare("SELECT claimed_by_runner_id FROM test_attempts WHERE id = ?")
    .bind("att_claim_worker")
    .first<{ claimed_by_runner_id: string | null }>();
  expect(row?.claimed_by_runner_id).toBe("vps-fallback");

  await repo.resetForInfraRetry("att_claim_worker", 3_000);
  const reset = await env.DB
    .prepare("SELECT claimed_by_runner_id FROM test_attempts WHERE id = ?")
    .bind("att_claim_worker")
    .first<{ claimed_by_runner_id: string | null }>();
  expect(reset?.claimed_by_runner_id).toBeNull();
});
```

Run: `cd apps/api && pnpm test:integration -- src/infrastructure/db/browser_test_repos.itest.ts` → FAIL (typecheck/arity).

- [ ] **Step 2: Repo D1 + fake + interfaz**

`domain/browser_tests/repo.ts`:
```ts
  claimQueued(
    id: string,
    claimedAt: number,
    runnerDeliveryId?: string,
    claimedByRunnerId?: string,
  ): Promise<boolean>;
```

`infrastructure/db/attempt_repo.ts`:
```ts
  async claimQueued(
    id: string,
    claimedAt: number,
    runnerDeliveryId?: string,
    claimedByRunnerId?: string,
  ): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE test_attempts
           SET status = 'STARTING', started_at = ?, runner_delivery_id = ?,
               claimed_by_runner_id = ?
           WHERE id = ? AND status = 'QUEUED' AND queued_at <= ?`,
        )
        .bind(claimedAt, runnerDeliveryId ?? null, claimedByRunnerId ?? null, id, claimedAt),
    );
    return result.meta.changes === 1;
  }
```
En `resetForInfraRetry` añadir `claimed_by_runner_id = NULL,` tras `runner_delivery_id = NULL,`.

Fake (`test/fakes/browser_test_repos.ts`): misma firma con el 4º parámetro; guardar `claimedByRunnerId` en un `Map<string, string | undefined>` público `claimedBy` para poder afirmarlo en tests (`this.claimedBy.set(id, claimedByRunnerId)`).

- [ ] **Step 3: Lifecycle y ExternalRunner**

`attempt_lifecycle.ts` — firma:
```ts
  async claim(
    message: AttemptMessage,
    runnerDeliveryId?: string,
    claimedByRunnerId?: string,
  ): Promise<"execute" | "skip"> {
```
y la llamada final:
```ts
    return (await this.dependencies.attempts.claimQueued(
      attempt.id,
      now,
      runnerDeliveryId,
      claimedByRunnerId,
    ))
      ? "execute"
      : "skip";
```

`external_runner.ts`:
```ts
  async claim(input: RunnerClaimInput): Promise<ExternalRunnerJob | null> {
    if (
      (await this.dependencies.lifecycle.claim(
        input.message,
        input.deliveryId,
        input.workerId,
      )) === "skip"
    ) {
      return null;
    }
    ...
  }

  async claimStale(input: {
    deliveryId: string;
    workerId?: string;
  }): Promise<ExternalRunnerJob | null> {
    ...
      const job = await this.claim({
        deliveryId: input.deliveryId,
        workerId: input.workerId,
        message: { ... },
      });
```

- [ ] **Step 4: Test de ruta** — en `runner.test.ts`, en el test "returns an executable job…", enviar `workerId: "mac-1"` en el body y cambiar el assert a `toHaveBeenCalledWith({ deliveryId: "queue-message-1", message: MESSAGE, workerId: "mac-1" })`. Añadir un test de que `workerId: "bad id!"` devuelve 400 `VALIDATION_ERROR`.

- [ ] **Step 5: Verificar**

Run: `pnpm --filter @zenguy/api typecheck && pnpm --filter @zenguy/api test -- src/http/routes/runner.test.ts src/application/execution && pnpm --filter @zenguy/api test:integration -- src/infrastructure/db/browser_test_repos.itest.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/domain/browser_tests/runner_protocol.ts apps/api/src/domain/browser_tests/repo.ts apps/api/src/infrastructure/db/attempt_repo.ts apps/api/src/test/fakes/browser_test_repos.ts apps/api/src/application/execution/attempt_lifecycle.ts apps/api/src/application/execution/external_runner.ts apps/api/src/infrastructure/db/browser_test_repos.itest.ts apps/api/src/http/routes/runner.test.ts
git commit -m "api: runner claims record the worker id"
```

### Task A5: `POST /api/runner/heartbeat` + wiring

**Files:**
- Modify: `apps/api/src/http/routes/runner.ts`
- Modify: `apps/api/src/app.ts` (override `runnerWorkers`, construir repo, pasar deps) — **edición mínima, hunk propio**
- Test: `apps/api/src/http/routes/runner.test.ts`

**Interfaces:**
- `RunnerRoutesDependencies { token; runner; workers: Pick<RunnerWorkerRepo, "recordHeartbeat">; clock: Clock }`
- `AppOverrides.runnerWorkers?: RunnerWorkerRepo`

- [ ] **Step 1: Tests (fallan primero)** — añadir a `runner.test.ts`:

```ts
import { FakeRunnerWorkerRepo } from "../../test/fakes/runners";
import { FixedClock } from "../../shared/clock";

describe("runner heartbeat", () => {
  it("rejects heartbeats without the runner token", async () => {
    const app = buildApp(fakeBindings(), { externalRunner: runner() });
    const response = await app.request("/api/runner/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId: "mac-1", mode: "local", version: "v", startedAt: 1 }),
    });
    expect(response.status).toBe(401);
  });

  it("upserts the worker with the server clock", async () => {
    const runnerWorkers = new FakeRunnerWorkerRepo();
    const clock = new FixedClock(50_000);
    const app = buildApp(fakeBindings(), { externalRunner: runner(), runnerWorkers, clock });
    const body = { workerId: "mac-1", mode: "local", version: "zenguy-local-runner/2.0.0", startedAt: 40_000 };

    const first = await app.request("/api/runner/heartbeat", { method: "POST", headers: headers(), body: JSON.stringify(body) });
    clock.advance(5_000);
    const second = await app.request("/api/runner/heartbeat", { method: "POST", headers: headers(), body: JSON.stringify(body) });

    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    await expect(second.json()).resolves.toEqual({ data: { ok: true } });
    expect(runnerWorkers.workers.get("mac-1")).toEqual({
      id: "mac-1", mode: "local", version: "zenguy-local-runner/2.0.0", startedAt: 40_000, firstSeenAt: 50_000, lastSeenAt: 55_000,
    });
  });

  it("validates the heartbeat payload", async () => {
    const app = buildApp(fakeBindings(), { externalRunner: runner(), runnerWorkers: new FakeRunnerWorkerRepo() });
    const response = await app.request("/api/runner/heartbeat", {
      method: "POST", headers: headers(),
      body: JSON.stringify({ workerId: "bad id!", mode: "queue", version: "", startedAt: -1 }),
    });
    expect(response.status).toBe(400);
    const payload = await response.json() as { error: { code: string } };
    expect(payload.error.code).toBe("VALIDATION_ERROR");
  });
});
```

Run: `pnpm --filter @zenguy/api test -- src/http/routes/runner.test.ts` → FAIL.

- [ ] **Step 2: Ruta**

En `runner.ts`:
```ts
import type { RunnerWorkerRepo } from "../../domain/runners/repo";
import type { Clock } from "../../shared/clock";
import { runnerHeartbeatSchema, ... } from "../../domain/browser_tests/runner_protocol";

export interface RunnerRoutesDependencies {
  token: string;
  runner: Pick<ExternalRunner, "claim" | "claimStale" | "start" | "recordStep" | "complete">;
  workers: Pick<RunnerWorkerRepo, "recordHeartbeat">;
  clock: Clock;
}

  app.post("/heartbeat", zjson(runnerHeartbeatSchema), async (context) => {
    await dependencies.workers.recordHeartbeat(
      context.req.valid("json"),
      dependencies.clock.now(),
    );
    return context.json({ data: { ok: true } });
  });
```

- [ ] **Step 3: Wiring en `app.ts`** (solo estas líneas):
  - import: `import { D1RunnerWorkerRepo } from "./infrastructure/db/runner_worker_repo";` y `import type { RunnerWorkerRepo } from "./domain/runners/repo";`
  - en `AppOverrides`: `runnerWorkers?: RunnerWorkerRepo;`
  - junto a `const attempts = ...`: `const runnerWorkers = overrides.runnerWorkers ?? new D1RunnerWorkerRepo(env.DB);`
  - en el `app.route("/api/runner", ...)`: `runnerRoutes({ token: config.runnerApiToken, runner: externalRunner, workers: runnerWorkers, clock })`.

- [ ] **Step 4: Verificar gate completo del backend**

Run: `pnpm --filter @zenguy/api typecheck && pnpm --filter @zenguy/api test && pnpm --filter @zenguy/api test:integration` → PASS. (Si falla algo ajeno a estos ficheros, comprobar en `git status` si es trabajo en vuelo de otra sesión antes de tocarlo.)

- [ ] **Step 5: Commit (solo hunk propio de app.ts)**

```bash
git add apps/api/src/http/routes/runner.ts apps/api/src/http/routes/runner.test.ts
git diff apps/api/src/app.ts   # localizar los hunks propios (D1RunnerWorkerRepo / runnerWorkers)
git diff apps/api/src/app.ts > /tmp/app.patch   # editar el patch dejando solo los hunks propios si hay cambios de otra sesión, y luego:
git apply --cached /tmp/app.patch
git commit -m "api: POST /api/runner/heartbeat registers runner workers"
```

---

## Parte B — `runner/browser_worker.py`: heartbeat e identidad

### Task B1: `worker_id` en la configuración y en los claims

**Files:**
- Modify: `runner/browser_worker.py` (`RunnerConfig`, `for_environment`, `for_fallback`, `AppClient.claim/claim_stale`)
- Test: `runner/test_browser_worker.py`

**Interfaces:**
- `resolve_worker_id(explicit: str | None) -> str` (módulo), `RunnerConfig.worker_id: str`, `AppClient.worker_id`.
- Body de `/attempts/claim` y `/attempts/claim-stale` incluye `"workerId": <worker_id>`.

- [ ] **Step 1: Tests (fallan primero)** — añadir a `runner/test_browser_worker.py`:

```python
class WorkerIdentityTests(unittest.TestCase):
    def test_explicit_worker_id_wins(self):
        self.assertEqual(worker.resolve_worker_id("vps-hetzner_1"), "vps-hetzner_1")

    def test_hostname_is_sanitised_to_the_allowed_alphabet(self):
        with mock.patch.object(worker.socket, "gethostname", return_value="Marcos’s MacBook Pro.local"):
            self.assertEqual(worker.resolve_worker_id(None), "Marcos-s-MacBook-Pro.local")

    def test_hostname_is_capped_and_never_empty(self):
        with mock.patch.object(worker.socket, "gethostname", return_value="x" * 100):
            self.assertEqual(len(worker.resolve_worker_id("")), 64)
        with mock.patch.object(worker.socket, "gethostname", return_value="***"):
            self.assertEqual(worker.resolve_worker_id(None), "worker")

    def test_rejects_invalid_explicit_ids(self):
        with self.assertRaises(worker.ConfigError):
            worker.resolve_worker_id("bad id!")
```

Y en `FallbackWorkerTests` (o una clase nueva `AppClientIdentityTests(unittest.IsolatedAsyncioTestCase)`), reutilizando el patrón de `test_claim_stale_posts_to_the_stale_endpoint` (mock de `_json_request` capturando `payload`): afirmar que el payload de `claim_stale` contiene `"workerId": "<id del config>"` y el de `claim` también.

Run: `cd runner && .venv/bin/python -m unittest test_browser_worker -k WorkerIdentity -k Identity` → FAIL (`resolve_worker_id` no existe).

- [ ] **Step 2: Implementación**

Cerca de `new_fallback_delivery_id`:
```python
WORKER_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def resolve_worker_id(explicit: str | None) -> str:
    """Identity reported in heartbeats and claims.

    Explicit values (``ZENGUY_WORKER_ID`` or ``worker_id`` in the local JSON)
    must already match the API alphabet; otherwise the hostname is sanitised.
    """
    value = (explicit or "").strip()
    if value:
        if not WORKER_ID_PATTERN.match(value):
            raise ConfigError("worker_id must be 1-64 chars of [A-Za-z0-9._-]")
        return value
    host = re.sub(r"[^A-Za-z0-9._-]+", "-", socket.gethostname())[:64].strip("-.")
    return host or "worker"
```

`RunnerConfig`: añadir `worker_id: str = "worker"` (campo con default, tras `chrome_executable`). En `for_environment`: `worker_id=resolve_worker_id(os.environ.get("ZENGUY_WORKER_ID") or secrets.get("worker_id"))`. En `for_fallback`: calcular `secrets` (ya cargado si faltaban env vars; si no, `secrets = {}`) y `worker_id=resolve_worker_id(env.get("ZENGUY_WORKER_ID") or secrets.get("worker_id"))`.

`AppClient.__init__`: `self.worker_id = config.worker_id`. `claim`: payload `{"deliveryId": delivery_id, "message": message, "workerId": self.worker_id}`; `claim_stale`: `{"deliveryId": delivery_id, "workerId": self.worker_id}`.

- [ ] **Step 3: Verificar**

Run: `cd runner && .venv/bin/python -m unittest test_browser_worker` → PASS (suite completa).

- [ ] **Step 4: Commit**

```bash
git add runner/browser_worker.py runner/test_browser_worker.py
git commit -m "runner: report a worker id in claims"
```

### Task B2: Hilo de heartbeat

**Files:**
- Modify: `runner/browser_worker.py` (`AppClient.heartbeat_sync`, clase `Heartbeat`, `Worker.run`, `FallbackWorker.run`)
- Test: `runner/test_browser_worker.py`
- Modify: `runner/README.md` (párrafo: heartbeat, `worker_id`, `ZENGUY_WORKER_ID`)

**Interfaces:**
- `HEARTBEAT_SECONDS = 5.0`
- `class Heartbeat(app: AppClient, *, worker_id: str, mode: str, version: str, started_at: int, interval: float = HEARTBEAT_SECONDS)` con `start()`, `stop()`, `beat_once() -> bool`.
- `AppClient.heartbeat_sync(payload: Mapping[str, Any]) -> None` (síncrono, sin reintentos; lanza `HttpRequestError`/`RetryableRunnerError`).

- [ ] **Step 1: Tests (fallan primero)**

```python
class HeartbeatTests(unittest.TestCase):
    def _app(self, calls, fail=False):
        class FakeApp:
            def heartbeat_sync(self, payload):
                calls.append(payload)
                if fail:
                    raise worker.RetryableRunnerError("down")
        return FakeApp()

    def test_beat_once_posts_the_identity_payload(self):
        calls = []
        beat = worker.Heartbeat(self._app(calls), worker_id="mac-1", mode="local", version="v1", started_at=123)
        self.assertTrue(beat.beat_once())
        self.assertEqual(calls, [{"workerId": "mac-1", "mode": "local", "version": "v1", "startedAt": 123}])

    def test_failures_are_logged_and_do_not_raise(self):
        calls = []
        beat = worker.Heartbeat(self._app(calls, fail=True), worker_id="mac-1", mode="fallback", version="v1", started_at=1)
        with mock.patch.object(worker, "log") as log:
            self.assertFalse(beat.beat_once())
        log.assert_called_once_with("heartbeat_failed", workerId="mac-1", error="RetryableRunnerError")

    def test_thread_beats_on_the_interval_until_stopped(self):
        calls = []
        beat = worker.Heartbeat(self._app(calls), worker_id="mac-1", mode="local", version="v1", started_at=1, interval=0.01)
        beat.start()
        time.sleep(0.08)
        beat.stop()
        self.assertGreaterEqual(len(calls), 3)
        count = len(calls)
        time.sleep(0.03)
        self.assertEqual(len(calls), count)
```
(añadir `import time` al test).

Run: `cd runner && .venv/bin/python -m unittest test_browser_worker -k Heartbeat` → FAIL.

- [ ] **Step 2: Implementación**

Añadir `import threading` y `import time` a los imports. Constante junto a `DEFAULT_POLL_SECONDS`: `HEARTBEAT_SECONDS = 5.0`.

En `AppClient`:
```python
    def heartbeat_sync(self, payload: Mapping[str, Any]) -> None:
        """Single attempt, synchronous: the heartbeat thread retries on its own tick."""
        _json_request(
            f"{self.root}/heartbeat",
            method="POST",
            headers=self.headers,
            payload=payload,
            timeout=10,
        )
```
(comprobar la firma de `_json_request` — acepta `timeout`.)

Clase (antes de `class Worker`):
```python
class Heartbeat:
    """Daemon thread that tells the API this worker is alive every few seconds."""

    def __init__(
        self,
        app: AppClient,
        *,
        worker_id: str,
        mode: str,
        version: str,
        started_at: int,
        interval: float = HEARTBEAT_SECONDS,
    ) -> None:
        self.app = app
        self.payload = {
            "workerId": worker_id,
            "mode": mode,
            "version": version,
            "startedAt": started_at,
        }
        self.interval = interval
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="zenguy-heartbeat", daemon=True)

    def beat_once(self) -> bool:
        try:
            self.app.heartbeat_sync(self.payload)
            return True
        except Exception as error:  # noqa: BLE001 - a heartbeat must never kill the worker
            log("heartbeat_failed", workerId=self.payload["workerId"], error=type(error).__name__)
            return False

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=self.interval + 1)

    def _run(self) -> None:
        self.beat_once()
        while not self._stop.wait(self.interval):
            self.beat_once()
```

`Worker.__init__` y `FallbackWorker.__init__`: 
```python
        self.heartbeat = Heartbeat(
            self.app,
            worker_id=config.worker_id,
            mode="local",            # "fallback" en FallbackWorker
            version=config.runner_version,
            started_at=int(time.time() * 1000),
        )
```
En ambos `run()`: `self.heartbeat.start()` justo tras el log `*_started`, y envolver el bucle en `try: ... finally: self.heartbeat.stop()`. (En `--once` el primer beat se emite al arrancar el hilo, cumpliendo el spec.)

- [ ] **Step 3: Verificar**

Run: `cd runner && .venv/bin/python -m unittest test_browser_worker` → PASS. Smoke opcional sin red: `.venv/bin/python -c "import browser_worker"`.

- [ ] **Step 4: README + commit**

Añadir a `runner/README.md` una nota: "Each worker sends `POST /api/runner/heartbeat` every 5 s with its `workerId` (env `ZENGUY_WORKER_ID`, `worker_id` in `.browser_worker.local.json`, or the sanitised hostname); claims carry the same id so admin.zenguy.com can attribute runs."

```bash
git add runner/browser_worker.py runner/test_browser_worker.py runner/README.md
git commit -m "runner: 5s heartbeat thread for admin worker health"
```

---

## Parte C — `apps/admin`: Worker (API Hono + assets)

### Task C1: Scaffold del paquete y Worker base

**Files:**
- Create: `apps/admin/package.json`, `apps/admin/tsconfig.json`, `apps/admin/tsconfig.client.json`, `apps/admin/wrangler.jsonc`, `apps/admin/vite.config.ts`, `apps/admin/vitest.config.ts`, `apps/admin/vitest.integration.config.ts`, `apps/admin/index.html`, `apps/admin/.gitignore`, `apps/admin/README.md`
- Create: `apps/admin/src/index.ts`, `apps/admin/src/server/env.ts`, `apps/admin/src/server/app.ts`, `apps/admin/src/server/errors.ts`, `apps/admin/src/server/constants.ts`, `apps/admin/src/server/constants.test.ts`, `apps/admin/src/server/app.test.ts`, `apps/admin/src/test/apply-migrations.ts`
- Create (placeholder para que exista el entry del cliente): `apps/admin/src/client/main.tsx` (se completa en D1)

**Interfaces:**
- `Bindings { DB: D1Database; ASSETS: Fetcher; ADMIN_EMAILS: string; ADMIN_SESSION_SECRET: string; ZENGUY_API_ORIGIN: string }`
- `buildApp(env: Bindings, overrides?: AppOverrides): Hono<AppEnv>` con `AppOverrides { clock?: Clock; fetch?: typeof fetch; delay?: (ms: number) => Promise<void> }`
- `AppError(code, message)`; `code ∈ "VALIDATION_ERROR" | "UNAUTHORIZED" | "NOT_FOUND" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "INTERNAL"`.
- `RUNNER_ONLINE_THRESHOLD_MS = 15_000`.

- [ ] **Step 1: Manifest y configs**

`apps/admin/package.json`:
```json
{
  "name": "@zenguy/admin",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:worker": "wrangler dev --port 8795",
    "build": "vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.client.json",
    "test": "vitest run --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "deploy": "pnpm build && wrangler deploy"
  },
  "dependencies": {
    "@hono/zod-validator": "^0.9.0",
    "@tanstack/react-query": "^5.101.4",
    "hono": "^4.13.2",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "react-router-dom": "^7.18.2",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.21.3",
    "@cloudflare/workers-types": "^5.20260817.1",
    "@tailwindcss/vite": "^4.3.3",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.4",
    "@vitejs/plugin-react": "^6.0.5",
    "tailwindcss": "^4.3.3",
    "typescript": "^7.0.2",
    "vite": "^8.2.1",
    "vitest": "^4.1.10",
    "wrangler": "^4.123.0"
  }
}
```
Run: `pnpm install` (en la raíz) para enlazar el workspace.

`apps/admin/tsconfig.json` (servidor + tests):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers/types", "vitest/globals"]
  },
  "include": ["src/index.ts", "src/server/**/*", "src/shared/**/*", "src/test/**/*", "vitest.*.ts", "vitest.config.ts"]
}
```

`apps/admin/tsconfig.client.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src/client/**/*", "src/shared/**/*", "vite.config.ts"]
}
```

`apps/admin/wrangler.jsonc`:
```jsonc
{
  // admin.zenguy.com — internal read-only platform panel. One Worker serves
  // the SPA (Workers Assets) and its API under /api/*; it binds the
  // PRODUCTION database and only ever runs SELECT statements.
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "zenguy-admin",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": true
  },
  "routes": [{ "pattern": "admin.zenguy.com", "custom_domain": true }],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "zenguy-db",
      "database_id": "82cdd9c1-591f-45c4-a115-17fcdc18950b"
    }
  ],
  "vars": {
    "ADMIN_EMAILS": "marcos@aguayo.es",
    "ZENGUY_API_ORIGIN": "https://api.zenguy.com"
  }
  // Secret (wrangler secret put): ADMIN_SESSION_SECRET (>= 32 chars)
}
```

`apps/admin/vite.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react(), tailwindcss()],
    build: { outDir: "dist/client", emptyOutDir: true },
    server: {
      port: 5175,
      proxy: {
        "/api": { target: env.ADMIN_API_ORIGIN || "http://127.0.0.1:8795", changeOrigin: false },
      },
    },
  };
});
```

`apps/admin/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], globals: true },
});
```

`apps/admin/vitest.integration.config.ts` (D1 local con las migraciones reales de `apps/api`; sin depender de `wrangler.jsonc` para no exigir que exista `dist/client`):
```ts
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(import.meta.dirname, "..", "api", "migrations"),
      );
      return {
        remoteBindings: false,
        miniflare: {
          compatibilityDate: "2026-08-01",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "zenguy-admin-test" },
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_EMAILS: "marcos@aguayo.es",
            ADMIN_SESSION_SECRET: "admin-test-secret".padEnd(32, "-"),
            ZENGUY_API_ORIGIN: "https://api.zenguy.test",
          },
        },
      };
    }),
  ],
  test: {
    include: ["src/**/*.itest.ts"],
    globals: true,
    setupFiles: ["./src/test/apply-migrations.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
```
(Si el plugin exige `wrangler.configPath`, usarlo y crear `dist/client/.gitkeep` antes de los tests con un script `pretest:integration: mkdir -p dist/client`.)

`apps/admin/src/test/apply-migrations.ts`:
```ts
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`apps/admin/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <title>Zenguy Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

`apps/admin/.gitignore`: `dist/`, `.wrangler/`, `.dev.vars`.

- [ ] **Step 2: Errores, env, constantes**

`src/server/errors.ts`:
```ts
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = "AppError";
  }

  get status(): number {
    return statusByCode[this.code];
  }
}
```

`src/server/env.ts`:
```ts
export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_EMAILS: string;
  ADMIN_SESSION_SECRET: string;
  ZENGUY_API_ORIGIN: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: { adminEmail: string };
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
```

`src/server/constants.ts`:
```ts
// Mirrors RUNNER_ONLINE_THRESHOLD_MS in apps/api/src/shared/constants.ts
// (3 missed 5-second heartbeats). Keep both in sync.
export const RUNNER_ONLINE_THRESHOLD_MS = 15_000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const SESSION_COOKIE = "zenguy_admin_session";
export const LOGIN_FAILURE_DELAY_MS = 300;
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
```

`src/server/constants.test.ts`:
```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { RUNNER_ONLINE_THRESHOLD_MS } from "./constants";

it("keeps the online threshold in sync with apps/api", () => {
  const source = readFileSync(
    path.join(import.meta.dirname, "../../../api/src/shared/constants.ts"),
    "utf8",
  );
  const match = /RUNNER_ONLINE_THRESHOLD_MS = ([\d_]+)/u.exec(source);
  expect(Number(match?.[1]?.replaceAll("_", ""))).toBe(RUNNER_ONLINE_THRESHOLD_MS);
});
```

- [ ] **Step 3: Test de la app base (falla primero)** — `src/server/app.test.ts`:

```ts
import { buildApp } from "./app";
import { fakeBindings } from "../test/fakes";

describe("admin app", () => {
  it("answers unknown API routes with a JSON 404 and security headers", async () => {
    const response = await buildApp(fakeBindings()).request("/api/nope");
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    await expect(response.json()).resolves.toEqual({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  it("serves everything else from the assets binding with the same headers", async () => {
    const bindings = fakeBindings();
    const response = await buildApp(bindings).request("/login");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>spa</html>");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
```

`src/test/fakes.ts`:
```ts
import type { Bindings } from "../server/env";

export function fakeBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: {} as D1Database,
    ASSETS: { fetch: async () => new Response("<html>spa</html>", { headers: { "content-type": "text/html" } }) } as unknown as Fetcher,
    ADMIN_EMAILS: "marcos@aguayo.es, Ops@Example.com",
    ADMIN_SESSION_SECRET: "admin-test-secret".padEnd(32, "-"),
    ZENGUY_API_ORIGIN: "https://api.zenguy.test",
    ...overrides,
  };
}
```

Run: `pnpm --filter @zenguy/admin test` → FAIL.

- [ ] **Step 4: App base**

`src/server/app.ts`:
```ts
import { Hono } from "hono";
import type { AppEnv, Bindings, Clock } from "./env";
import { systemClock } from "./env";
import { AppError } from "./errors";

export interface AppOverrides {
  clock?: Clock;
  fetch?: typeof fetch;
  delay?: (milliseconds: number) => Promise<void>;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", CSP);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function buildApp(env: Bindings, overrides: AppOverrides = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const clock = overrides.clock ?? systemClock;
  void clock; void overrides; // usados por C3/C6

  app.use("/api/*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });

  app.onError((error, context) => {
    const appError = error instanceof AppError ? error : new AppError("INTERNAL", "Unexpected error");
    if (appError.code === "INTERNAL") console.error("admin_unhandled_error", error);
    return withSecurityHeaders(
      context.json(
        { error: { code: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) } },
        appError.status as 400,
      ),
    );
  });

  app.all("/api/*", (context) => {
    throw new AppError("NOT_FOUND", "Route not found");
  });

  app.all("*", async (context) => withSecurityHeaders(await env.ASSETS.fetch(context.req.raw)));

  app.use("*", async (context, next) => { await next(); });
  return app;
}
```
Nota de orden: en Hono las rutas se evalúan en orden de registro; registrar el middleware `app.use("*", …)` de cabeceras **antes** de las rutas para que aplique a todas las respuestas JSON (las respuestas del `onError` ya pasan por `withSecurityHeaders`). Implementación limpia: un único `app.use("*", async (c, next) => { await next(); aplicar cabeceras a `c.res` })`. Las rutas `/api/auth` y `/api` de C3/C6 se montan **antes** del catch-all `app.all("/api/*")`.

`src/index.ts`:
```ts
import type { Bindings } from "./server/env";
import { buildApp } from "./server/app";

let cached: ReturnType<typeof buildApp> | null = null;

export default {
  fetch(request: Request, env: Bindings, context: ExecutionContext): Promise<Response> | Response {
    cached ??= buildApp(env);
    return cached.fetch(request, env, context);
  },
};
```
(Como `buildApp` captura `env.ASSETS`, y los bindings son estables por isolate, cachear es seguro; alternativamente construir por request — es barato.)

- [ ] **Step 5: Verificar**

Run: `pnpm --filter @zenguy/admin typecheck && pnpm --filter @zenguy/admin test` → PASS. Run: `pnpm --filter @zenguy/admin test:integration` → "No test files found" aceptable hasta C5, pero el setup de migraciones debe cargar sin error (crear un `src/server/db/smoke.itest.ts` que haga `SELECT COUNT(*) FROM runner_workers` → 0 para validar el pool).

- [ ] **Step 6: Commit**

```bash
git add apps/admin pnpm-lock.yaml
git commit -m "admin: scaffold zenguy-admin worker (assets + API shell)"
```

### Task C2: Sesión firmada y allowlist

**Files:**
- Create: `apps/admin/src/server/session.ts`, `apps/admin/src/server/session.test.ts`
- Create: `apps/admin/src/server/allowlist.ts`, `apps/admin/src/server/allowlist.test.ts`

**Interfaces:**
- `signSession(payload: { email: string; exp: number }, secret: string): Promise<string>`
- `verifySession(token: string, secret: string, now: number): Promise<{ email: string } | null>`
- `sessionCookie(token: string, maxAgeSeconds: number): string` / `clearSessionCookie(): string` (cadenas `Set-Cookie`)
- `readCookie(header: string | undefined, name: string): string | null`
- `parseAdminEmails(raw: string): Set<string>` (minúsculas, trim, vacíos fuera) / `isAdminEmail(raw: string, email: string): boolean`

- [ ] **Step 1: Tests (fallan primero)**

`session.test.ts`:
```ts
import { clearSessionCookie, readCookie, sessionCookie, signSession, verifySession } from "./session";

const SECRET = "s".repeat(32);

describe("admin session", () => {
  it("round-trips a signed payload", async () => {
    const token = await signSession({ email: "marcos@aguayo.es", exp: 2_000 }, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    await expect(verifySession(token, SECRET, 1_000)).resolves.toEqual({ email: "marcos@aguayo.es" });
  });

  it("rejects expired, tampered, foreign-key and malformed tokens", async () => {
    const token = await signSession({ email: "marcos@aguayo.es", exp: 2_000 }, SECRET);
    const [payload, signature] = token.split(".") as [string, string];
    await expect(verifySession(token, SECRET, 2_000)).resolves.toBeNull();
    await expect(verifySession(`${payload}x.${signature}`, SECRET, 1_000)).resolves.toBeNull();
    await expect(verifySession(token, "t".repeat(32), 1_000)).resolves.toBeNull();
    await expect(verifySession("garbage", SECRET, 1_000)).resolves.toBeNull();
    await expect(verifySession("", SECRET, 1_000)).resolves.toBeNull();
  });

  it("builds host-only secure cookies", () => {
    expect(sessionCookie("abc", 604_800)).toBe(
      "zenguy_admin_session=abc; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(clearSessionCookie()).toBe(
      "zenguy_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(readCookie("a=1; zenguy_admin_session=tok.en; b=2", "zenguy_admin_session")).toBe("tok.en");
    expect(readCookie(undefined, "zenguy_admin_session")).toBeNull();
  });
});
```

`allowlist.test.ts`:
```ts
import { isAdminEmail, parseAdminEmails } from "./allowlist";

it("normalises the comma separated allowlist", () => {
  expect([...parseAdminEmails(" Marcos@Aguayo.es ,ops@example.com,, ")]).toEqual(["marcos@aguayo.es", "ops@example.com"]);
  expect(isAdminEmail("marcos@aguayo.es", "MARCOS@aguayo.es")).toBe(true);
  expect(isAdminEmail("marcos@aguayo.es", "other@aguayo.es")).toBe(false);
  expect(isAdminEmail("", "marcos@aguayo.es")).toBe(false);
});
```

Run: `pnpm --filter @zenguy/admin test` → FAIL.

- [ ] **Step 2: Implementación**

`session.ts`:
```ts
import { SESSION_COOKIE } from "./constants";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

export interface SessionPayload { email: string; exp: number }

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${toBase64Url(await hmac(encoded, secret))}`;
}

export async function verifySession(token: string, secret: string, now: number): Promise<{ email: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];
  const provided = fromBase64Url(signature);
  if (provided === null) return null;
  if (!timingSafeEqual(provided, await hmac(encoded, secret))) return null;
  const raw = fromBase64Url(encoded);
  if (raw === null) return null;
  let payload: unknown;
  try { payload = JSON.parse(decoder.decode(raw)); } catch { return null; }
  if (typeof payload !== "object" || payload === null) return null;
  const { email, exp } = payload as Partial<SessionPayload>;
  if (typeof email !== "string" || typeof exp !== "number" || exp <= now) return null;
  return { email };
}

const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; ${COOKIE_ATTRIBUTES}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}
```

`allowlist.ts`:
```ts
export function parseAdminEmails(raw: string): Set<string> {
  return new Set(
    raw.split(",").map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0),
  );
}

export function isAdminEmail(raw: string, email: string): boolean {
  return parseAdminEmails(raw).has(email.trim().toLowerCase());
}
```

- [ ] **Step 3: Verificar y commit**

Run: `pnpm --filter @zenguy/admin test` → PASS.
```bash
git add apps/admin/src/server/session.ts apps/admin/src/server/session.test.ts apps/admin/src/server/allowlist.ts apps/admin/src/server/allowlist.test.ts
git commit -m "admin: signed session cookie and ADMIN_EMAILS allowlist"
```

### Task C3: Rutas de auth (login delegado, logout, me) y middleware de sesión

**Files:**
- Create: `apps/admin/src/server/routes/auth.ts`, `apps/admin/src/server/routes/auth.test.ts`, `apps/admin/src/server/require_session.ts`
- Modify: `apps/admin/src/server/app.ts` (montar `/api/auth`)

**Interfaces:**
- `authRoutes(deps: { adminEmails: string; secret: string; apiOrigin: string; fetch: typeof fetch; clock: Clock; delay: (ms: number) => Promise<void> }): Hono<AppEnv>`
- `requireSession(deps: { secret: string; clock: Clock })` middleware: pone `context.set("adminEmail", email)` o lanza `UNAUTHORIZED`.
- Errores de login: 401 `INVALID_CREDENTIALS`-like → usamos `UNAUTHORIZED` con mensaje "Invalid credentials"; API caída → 503 `SERVICE_UNAVAILABLE` "Production API is not reachable"; 429 de la API → 429 `RATE_LIMITED` "Too many attempts, try again later".

- [ ] **Step 1: Tests (fallan primero)** — `routes/auth.test.ts`:

```ts
import { buildApp } from "../app";
import { fakeBindings } from "../../test/fakes";

function fetchReturning(status: number, body: unknown = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const noDelay = async () => {};
const clock = { now: () => 1_700_000_000_000 };

async function login(app: ReturnType<typeof buildApp>, body: unknown) {
  return app.request("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("admin auth", () => {
  it("logs in an allowlisted account validated by the production API and sets the cookie", async () => {
    const { calls, fetchImpl } = fetchReturning(200, { data: { accessToken: "discarded" } });
    const app = buildApp(fakeBindings(), { fetch: fetchImpl, delay: noDelay, clock });

    const response = await login(app, { email: " Marcos@Aguayo.es ", password: "abc123456" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { email: "marcos@aguayo.es" } });
    expect(calls[0]?.url).toBe("https://api.zenguy.test/api/auth/login");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ email: "marcos@aguayo.es", password: "abc123456" });
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^zenguy_admin_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Max-Age=604800; Path=\/; HttpOnly; Secure; SameSite=Lax$/u);

    const me = await app.request("/api/auth/me", { headers: { Cookie: cookie.split(";")[0] ?? "" } });
    await expect(me.json()).resolves.toEqual({ data: { email: "marcos@aguayo.es" } });
  });

  it("rejects non-admin emails without contacting the API, with a generic error and a delay", async () => {
    const { calls, fetchImpl } = fetchReturning(200);
    const delay = vi.fn(async () => {});
    const app = buildApp(fakeBindings(), { fetch: fetchImpl, delay, clock });

    const response = await login(app, { email: "intruder@example.com", password: "whatever" });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "UNAUTHORIZED", message: "Invalid credentials" } });
    expect(calls).toHaveLength(0);
    expect(delay).toHaveBeenCalledWith(300);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects wrong passwords with the same generic error", async () => {
    const { fetchImpl } = fetchReturning(401, { error: { code: "INVALID_CREDENTIALS" } });
    const app = buildApp(fakeBindings(), { fetch: fetchImpl, delay: noDelay, clock });
    const response = await login(app, { email: "marcos@aguayo.es", password: "nope" });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "UNAUTHORIZED", message: "Invalid credentials" } });
  });

  it("surfaces API rate limiting and unavailability", async () => {
    const limited = buildApp(fakeBindings(), { fetch: fetchReturning(429).fetchImpl, delay: noDelay, clock });
    expect((await login(limited, { email: "marcos@aguayo.es", password: "x" })).status).toBe(429);

    const down = buildApp(fakeBindings(), {
      fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch, delay: noDelay, clock,
    });
    const response = await login(down, { email: "marcos@aguayo.es", password: "x" });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "SERVICE_UNAVAILABLE", message: "Production API is not reachable" } });
  });

  it("validates the body", async () => {
    const app = buildApp(fakeBindings(), { fetch: fetchReturning(200).fetchImpl, delay: noDelay, clock });
    expect((await login(app, { email: "not-an-email", password: "" })).status).toBe(400);
  });

  it("requires a valid session for /me and clears it on logout", async () => {
    const app = buildApp(fakeBindings(), { fetch: fetchReturning(200).fetchImpl, delay: noDelay, clock });
    expect((await app.request("/api/auth/me")).status).toBe(401);
    expect((await app.request("/api/auth/me", { headers: { Cookie: "zenguy_admin_session=bad.token" } })).status).toBe(401);
    const logout = await app.request("/api/auth/logout", { method: "POST" });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("Set-Cookie")).toBe("zenguy_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
  });
});
```

Run: `pnpm --filter @zenguy/admin test -- src/server/routes/auth.test.ts` → FAIL.

- [ ] **Step 2: Implementación**

`require_session.ts`:
```ts
import { createMiddleware } from "hono/factory";
import { SESSION_COOKIE } from "./constants";
import type { AppEnv, Clock } from "./env";
import { AppError } from "./errors";
import { readCookie, verifySession } from "./session";

export function requireSession(deps: { secret: string; clock: Clock }) {
  return createMiddleware<AppEnv>(async (context, next) => {
    const token = readCookie(context.req.header("Cookie"), SESSION_COOKIE);
    const session = token === null ? null : await verifySession(token, deps.secret, deps.clock.now());
    if (session === null) throw new AppError("UNAUTHORIZED", "Admin session required");
    context.set("adminEmail", session.email);
    await next();
  });
}
```

`routes/auth.ts`:
```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { isAdminEmail } from "../allowlist";
import { LOGIN_FAILURE_DELAY_MS, SESSION_TTL_MS } from "../constants";
import type { AppEnv, Clock } from "../env";
import { AppError } from "../errors";
import { requireSession } from "../require_session";
import { clearSessionCookie, sessionCookie, signSession } from "../session";

export interface AuthRoutesDependencies {
  adminEmails: string;
  secret: string;
  apiOrigin: string;
  fetch: typeof fetch;
  clock: Clock;
  delay: (milliseconds: number) => Promise<void>;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(100),
});

type Verdict = "valid" | "invalid" | "rate_limited" | "unavailable";

async function verifyWithApi(deps: AuthRoutesDependencies, email: string, password: string): Promise<Verdict> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.apiOrigin.replace(/\/$/u, "")}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "zenguy-admin/1.0" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return "unavailable";
  }
  if (response.status === 200) return "valid";
  if (response.status === 429) return "rate_limited";
  if (response.status === 401 || response.status === 403 || response.status === 400) return "invalid";
  return "unavailable";
}

export function authRoutes(deps: AuthRoutesDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/login", zValidator("json", loginSchema, (result) => {
    if (!result.success) throw new AppError("VALIDATION_ERROR", "Invalid login payload");
  }), async (context) => {
    const { email, password } = context.req.valid("json");
    const reject = async (): Promise<never> => {
      await deps.delay(LOGIN_FAILURE_DELAY_MS);
      throw new AppError("UNAUTHORIZED", "Invalid credentials");
    };
    if (!isAdminEmail(deps.adminEmails, email)) return reject();
    const verdict = await verifyWithApi(deps, email, password);
    if (verdict === "invalid") return reject();
    if (verdict === "rate_limited") throw new AppError("RATE_LIMITED", "Too many attempts, try again later");
    if (verdict === "unavailable") throw new AppError("SERVICE_UNAVAILABLE", "Production API is not reachable");
    const token = await signSession({ email, exp: deps.clock.now() + SESSION_TTL_MS }, deps.secret);
    context.header("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1_000));
    return context.json({ data: { email } });
  });

  app.post("/logout", (context) => {
    context.header("Set-Cookie", clearSessionCookie());
    return context.body(null, 204);
  });

  app.get("/me", requireSession(deps), (context) =>
    context.json({ data: { email: context.get("adminEmail") } }),
  );

  return app;
}
```

En `app.ts`: `const fetchImpl = overrides.fetch ?? fetch.bind(globalThis); const delay = overrides.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));` y `app.route("/api/auth", authRoutes({ adminEmails: env.ADMIN_EMAILS, secret: env.ADMIN_SESSION_SECRET, apiOrigin: env.ZENGUY_API_ORIGIN, fetch: fetchImpl, clock, delay }));` antes del catch-all `/api/*`.

- [ ] **Step 3: Verificar y commit**

Run: `pnpm --filter @zenguy/admin typecheck && pnpm --filter @zenguy/admin test` → PASS.
```bash
git add apps/admin/src/server
git commit -m "admin: delegated login against the production API"
```

### Task C4: `countOccurrences` (previsión de ejecuciones)

**Files:**
- Create: `apps/admin/src/server/occurrences.ts`, `apps/admin/src/server/occurrences.test.ts`

**Interfaces:**
- `countOccurrences(nextAt: number, intervalMs: number, now: number, windowEndMs: number): number`
- `upcomingWindows(items: { nextAt: number; intervalMs: number }[], now: number): { h1: number; h3: number; h24: number }`

- [ ] **Step 1: Tests (fallan primero)**

```ts
import { countOccurrences, upcomingWindows } from "./occurrences";

const H = 3_600_000;

describe("countOccurrences", () => {
  it("counts runs scheduled inside [now, windowEnd]", () => {
    expect(countOccurrences(100 + H, H, 100, 100 + 3 * H)).toBe(3);      // at +1h, +2h, +3h
    expect(countOccurrences(100 + 3 * H, H, 100, 100 + 3 * H)).toBe(1);  // exactly on the boundary
    expect(countOccurrences(100 + 3 * H + 1, H, 100, 100 + 3 * H)).toBe(0);
  });

  it("treats an overdue item as running now, then keeps its cadence", () => {
    expect(countOccurrences(50, H, 100, 100 + H)).toBe(2);      // now + 1h later
    expect(countOccurrences(50, H, 100, 100 + H - 1)).toBe(1);
  });

  it("is defensive about bad intervals", () => {
    expect(countOccurrences(100, 0, 100, 100 + H)).toBe(0);
    expect(countOccurrences(100, -5, 100, 100 + H)).toBe(0);
  });
});

it("aggregates the three windows", () => {
  expect(upcomingWindows([{ nextAt: 100 + H / 2, intervalMs: H }, { nextAt: 100 + 20 * H, intervalMs: 6 * H }], 100))
    .toEqual({ h1: 1, h3: 3, h24: 25 });
});
```

- [ ] **Step 2: Implementación**

```ts
import { HOUR_MS } from "./constants";

export function countOccurrences(nextAt: number, intervalMs: number, now: number, windowEndMs: number): number {
  if (!(intervalMs > 0) || windowEndMs < now) return 0;
  const first = Math.max(nextAt, now);
  if (first > windowEndMs) return 0;
  return Math.floor((windowEndMs - first) / intervalMs) + 1;
}

export function upcomingWindows(items: { nextAt: number; intervalMs: number }[], now: number) {
  const sum = (hours: number) =>
    items.reduce((total, item) => total + countOccurrences(item.nextAt, item.intervalMs, now, now + hours * HOUR_MS), 0);
  return { h1: sum(1), h3: sum(3), h24: sum(24) };
}
```

- [ ] **Step 3: Verificar y commit**

Run: `pnpm --filter @zenguy/admin test -- src/server/occurrences.test.ts` → PASS.
```bash
git add apps/admin/src/server/occurrences.ts apps/admin/src/server/occurrences.test.ts
git commit -m "admin: forecast upcoming runs and checks per window"
```

### Task C5: Consultas D1 (solo SELECT) con degradación `MIGRATION_PENDING`

**Files:**
- Create: `apps/admin/src/shared/types.ts` (contratos de respuesta compartidos con el cliente)
- Create: `apps/admin/src/server/db/errors.ts`, `apps/admin/src/server/db/overview.ts`, `apps/admin/src/server/db/workers.ts`, `apps/admin/src/server/db/users.ts`, `apps/admin/src/server/db/runs.ts`
- Test: `apps/admin/src/server/db/queries.itest.ts`, `apps/admin/src/server/db/errors.test.ts`

**Interfaces (en `src/shared/types.ts`):**
```ts
export type Unavailable = { unavailable: "MIGRATION_PENDING" };
export interface PastRunsWindow { total: number; byStatus: Record<string, number>; passRate: number | null; avgDurationMs: number | null }
export interface PastChecksWindow { total: number; up: number; down: number; avgResponseMs: number | null }
export interface Windows<T> { h1: T; h3: T; h24: T }
export interface Overview {
  users: { total: number; verified: number; newLast7d: number };
  workspaces: { total: number };
  browserTests: { active: number };
  uptimeMonitors: { total: number; up: number; down: number; unknown: number };
  browserRuns: { past: Windows<PastRunsWindow>; upcoming: Windows<number> };
  uptimeChecks: { past: Windows<PastChecksWindow>; upcoming: Windows<number> };
}
export interface WorkerSummary {
  id: string; mode: "local" | "fallback"; version: string; startedAt: number; firstSeenAt: number; lastSeenAt: number; online: boolean;
  currentAttempt: { attemptId: string; runId: string; testName: string | null; workspaceName: string | null; startedAt: number | null } | null;
}
export type WorkersResponse = { workers: WorkerSummary[]; now: number } | Unavailable;
export interface UserSummary { id: string; email: string; name: string; createdAt: number; emailVerified: boolean; workspaceCount: number; lastActiveAt: number | null }
export interface RecentRun {
  id: string; createdAt: number; workspaceName: string | null; testName: string | null; source: string; status: string;
  durationMs: number | null; attemptCount: number; passedAfterRetry: boolean; runnerId: string | null | "MIGRATION_PENDING"; runnerKind: string | null;
}
```
- Funciones: `loadOverview(db, now): Promise<Overview>`, `loadWorkers(db, now): Promise<WorkersResponse>`, `loadUsers(db, limit): Promise<UserSummary[]>`, `loadRecentRuns(db, limit): Promise<RecentRun[]>`, `isMigrationPendingError(error: unknown): boolean`.

- [ ] **Step 1: Test unitario de detección de esquema pendiente** — `db/errors.test.ts`:
```ts
import { isMigrationPendingError } from "./errors";
it("recognises D1 schema errors", () => {
  expect(isMigrationPendingError(new Error("D1_ERROR: no such table: runner_workers: SQLITE_ERROR"))).toBe(true);
  expect(isMigrationPendingError(new Error("no such column: claimed_by_runner_id"))).toBe(true);
  expect(isMigrationPendingError(new Error("D1_ERROR: database is locked"))).toBe(false);
  expect(isMigrationPendingError("nope")).toBe(false);
});
```
`db/errors.ts`:
```ts
export function isMigrationPendingError(error: unknown): boolean {
  return error instanceof Error && /no such (?:table|column)/iu.test(error.message);
}
```

- [ ] **Step 2: Test de integración (falla primero)** — `db/queries.itest.ts`. Fixture mínima insertada con SQL directo (columnas NOT NULL de cada tabla según `apps/api/migrations`): 2 users (uno verificado, creado hace 2 días; otro no verificado hace 30 días), 1 workspace + 2 members, 1 browser_test activo (`interval_hours` 1, `next_run_at` = now+30min) y 1 borrado, 2 test_runs (PASSED 60s hace 30 min, FAILED hace 5 h) con attempts (`claimed_by_runner_id` 'vps-1' en el segundo), 1 uptime_monitor UP (`frequency_seconds` 300, `next_check_at` now+60s) y 2 uptime_checks (PASSED 120ms hace 10 min, FAILED hace 2 h), 1 runner_worker visto hace 3 s y otro hace 60 s, refresh_tokens para el usuario 1 (created_at hace 1 h).

Asserts:
```ts
const overview = await loadOverview(env.DB, NOW);
expect(overview.users).toEqual({ total: 2, verified: 1, newLast7d: 1 });
expect(overview.workspaces.total).toBe(1);
expect(overview.browserTests.active).toBe(1);
expect(overview.uptimeMonitors).toEqual({ total: 1, up: 1, down: 0, unknown: 0 });
expect(overview.browserRuns.past.h1).toEqual({ total: 1, byStatus: { PASSED: 1 }, passRate: 1, avgDurationMs: 60_000 });
expect(overview.browserRuns.past.h24.total).toBe(2);
expect(overview.browserRuns.past.h24.passRate).toBe(0.5);
expect(overview.browserRuns.upcoming).toEqual({ h1: 1, h3: 3, h24: 24 });
expect(overview.uptimeChecks.past.h1).toEqual({ total: 1, up: 1, down: 0, avgResponseMs: 120 });
expect(overview.uptimeChecks.upcoming.h1).toBe(12);

const workers = await loadWorkers(env.DB, NOW);
// online: vps-1 (3 s), offline: mac-1 (60 s); vps-1 tiene currentAttempt del run RUNNING
const users = await loadUsers(env.DB, 50);
expect(users.map((u) => u.email)).toEqual(["one@example.com", "two@example.com"]); // activo primero, sin datos al final
expect(users[0]).toMatchObject({ workspaceCount: 1, emailVerified: true, lastActiveAt: NOW - 3_600_000 });
const runs = await loadRecentRuns(env.DB, 50);
expect(runs[0]).toMatchObject({ status: "PASSED", runnerId: null, testName: "Homepage", workspaceName: "Acme" });
```
Y un test de degradación: `await env.DB.exec("DROP TABLE runner_workers"); await env.DB.exec("ALTER TABLE test_attempts DROP COLUMN claimed_by_runner_id");` → `loadWorkers` devuelve `{ unavailable: "MIGRATION_PENDING" }`, `loadRecentRuns` devuelve filas con `runnerId: "MIGRATION_PENDING"`, y `loadOverview` sigue funcionando. (Como `fileParallelism: false` y el storage del pool se aísla por test con `isolatedStorage`, el DROP no contamina otros tests; si no, ejecutar el test de degradación el último y recrear la tabla al final.)

- [ ] **Step 3: Implementación de las consultas** (todas `SELECT`, columnas explícitas):

`db/overview.ts` — claves:
```ts
const usersRow = await db.prepare(
  `SELECT COUNT(*) AS total,
          SUM(CASE WHEN email_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified,
          SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_last_7d
   FROM users`).bind(now - 7 * DAY_MS).first<{ total: number; verified: number | null; new_last_7d: number | null }>();
// workspaces: SELECT COUNT(*) AS total FROM workspaces WHERE deleted_at IS NULL
// browser_tests: SELECT COUNT(*) AS active FROM browser_tests WHERE deleted_at IS NULL
// monitors: SELECT COUNT(*) total, SUM(current_status='UP') up, SUM(current_status='DOWN') down, SUM(current_status='UNKNOWN') unknown FROM uptime_monitors WHERE deleted_at IS NULL
// runs por ventana: SELECT status, COUNT(*) AS total, SUM(duration_ms) AS duration_sum, COUNT(duration_ms) AS duration_count FROM test_runs WHERE created_at >= ? GROUP BY status
//   passRate = PASSED / (PASSED+FAILED+TIMEOUT+SYSTEM_ERROR) (null si 0 terminados); avgDurationMs = duration_sum/duration_count (null si 0)
// checks por ventana: SELECT status, COUNT(*) AS total, SUM(response_time_ms) AS response_sum, COUNT(response_time_ms) AS response_count FROM uptime_checks WHERE checked_at >= ? GROUP BY status  (PASSED→up, FAILED→down)
// upcoming browser: SELECT next_run_at, interval_hours FROM browser_tests WHERE deleted_at IS NULL → upcomingWindows(nextAt, interval_hours*HOUR_MS)
// upcoming uptime:  SELECT next_check_at, frequency_seconds FROM uptime_monitors WHERE deleted_at IS NULL → upcomingWindows(nextAt, frequency_seconds*1000)
```
Las tres ventanas se calculan con `Promise.all` sobre `[1, 3, 24]` horas.

`db/workers.ts`:
```ts
export async function loadWorkers(db: D1Database, now: number): Promise<WorkersResponse> {
  try {
    const [workers, attempts] = await Promise.all([
      db.prepare(`SELECT id, mode, version, started_at, first_seen_at, last_seen_at FROM runner_workers ORDER BY last_seen_at DESC`).all<WorkerRow>(),
      db.prepare(
        `SELECT attempts.id AS attempt_id, attempts.test_run_id AS run_id, attempts.claimed_by_runner_id AS runner_id,
                attempts.started_at, json_extract(runs.snapshot_json, '$.name') AS test_name, workspaces.name AS workspace_name
         FROM test_attempts AS attempts
         JOIN test_runs AS runs ON runs.id = attempts.test_run_id
         LEFT JOIN workspaces ON workspaces.id = runs.workspace_id
         WHERE attempts.status IN ('STARTING', 'RUNNING') AND attempts.claimed_by_runner_id IS NOT NULL`).all<AttemptRow>(),
    ]);
    const byRunner = new Map(attempts.results.map((row) => [row.runner_id, row]));
    return {
      now,
      workers: workers.results.map((row) => ({
        id: row.id, mode: row.mode, version: row.version, startedAt: row.started_at, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
        online: now - row.last_seen_at < RUNNER_ONLINE_THRESHOLD_MS,
        currentAttempt: byRunner.has(row.id) ? { attemptId: a.attempt_id, runId: a.run_id, testName: a.test_name, workspaceName: a.workspace_name, startedAt: a.started_at } : null,
      })),
    };
  } catch (error) {
    if (isMigrationPendingError(error)) return { unavailable: "MIGRATION_PENDING" };
    throw error;
  }
}
```

`db/users.ts`:
```sql
SELECT users.id, users.email, users.name, users.created_at, users.email_verified_at,
       (SELECT COUNT(*) FROM workspace_members AS members WHERE members.user_id = users.id) AS workspace_count,
       (SELECT MAX(tokens.created_at) FROM refresh_tokens AS tokens WHERE tokens.user_id = users.id) AS last_active_at
FROM users
ORDER BY last_active_at DESC NULLS LAST, users.created_at DESC
LIMIT ?
```

`db/runs.ts` (dos variantes: con `claimed_by_runner_id` y, si falla por esquema, sin ella devolviendo `runnerId: "MIGRATION_PENDING"`):
```sql
SELECT runs.id, runs.created_at, runs.source, runs.status, runs.duration_ms, runs.attempt_count, runs.passed_after_retry,
       workspaces.name AS workspace_name, json_extract(runs.snapshot_json, '$.name') AS test_name,
       (SELECT attempts.claimed_by_runner_id FROM test_attempts AS attempts WHERE attempts.test_run_id = runs.id ORDER BY attempts.attempt_index DESC LIMIT 1) AS runner_id,
       (SELECT attempts.runner_kind FROM test_attempts AS attempts WHERE attempts.test_run_id = runs.id ORDER BY attempts.attempt_index DESC LIMIT 1) AS runner_kind
FROM test_runs AS runs
LEFT JOIN workspaces ON workspaces.id = runs.workspace_id
ORDER BY runs.created_at DESC
LIMIT ?
```

- [ ] **Step 4: Verificar y commit**

Run: `pnpm --filter @zenguy/admin typecheck && pnpm --filter @zenguy/admin test && pnpm --filter @zenguy/admin test:integration` → PASS.
```bash
git add apps/admin/src/shared apps/admin/src/server/db
git commit -m "admin: read-only D1 queries for overview, workers, users and runs"
```

### Task C6: Rutas de datos protegidas

**Files:**
- Create: `apps/admin/src/server/routes/data.ts`, `apps/admin/src/server/routes/data.test.ts`
- Modify: `apps/admin/src/server/app.ts` (montar `/api` con `requireSession`)

**Interfaces:**
- `dataRoutes(deps: { db: D1Database; clock: Clock; secret: string; loaders?: { overview?; workers?; users?; runs? } })` — `loaders` inyectables para tests unitarios (por defecto las funciones de C5).
- `GET /api/overview`, `GET /api/workers`, `GET /api/users?limit=`, `GET /api/runs/recent?limit=` → `{ data }`; `limit` zod `coerce.number().int().min(1).max(200).default(50)`.

- [ ] **Step 1: Tests (fallan primero)** — `routes/data.test.ts`: con `fetchReturning(200)` hacer login (como en C3) y guardar la cookie; comprobar: sin cookie → 401 en las 4 rutas; con cookie → 200 y `{ data: <lo que devuelve el loader fake> }`; `loaders.users` recibe `limit` 50 por defecto y 200 con `?limit=200`; `?limit=0` → 400; `Cache-Control: no-store`.

- [ ] **Step 2: Implementación**

```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../constants";
import { loadOverview } from "../db/overview";
import { loadRecentRuns } from "../db/runs";
import { loadUsers } from "../db/users";
import { loadWorkers } from "../db/workers";
import type { AppEnv, Clock } from "../env";
import { AppError } from "../errors";
import { requireSession } from "../require_session";

const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT) });
const validateLimit = zValidator("query", limitSchema, (result) => {
  if (!result.success) throw new AppError("VALIDATION_ERROR", "limit must be an integer between 1 and 200");
});

export function dataRoutes(deps: { db: D1Database; clock: Clock; secret: string; loaders?: Partial<Loaders> }): Hono<AppEnv> {
  const loaders: Loaders = { overview: loadOverview, workers: loadWorkers, users: loadUsers, runs: loadRecentRuns, ...deps.loaders };
  const app = new Hono<AppEnv>();
  app.use("*", requireSession(deps));
  app.get("/overview", async (c) => c.json({ data: await loaders.overview(deps.db, deps.clock.now()) }));
  app.get("/workers", async (c) => c.json({ data: await loaders.workers(deps.db, deps.clock.now()) }));
  app.get("/users", validateLimit, async (c) => c.json({ data: { users: await loaders.users(deps.db, c.req.valid("query").limit) } }));
  app.get("/runs/recent", validateLimit, async (c) => c.json({ data: { runs: await loaders.runs(deps.db, c.req.valid("query").limit) } }));
  return app;
}
```
En `app.ts`: `app.route("/api", dataRoutes({ db: env.DB, clock, secret: env.ADMIN_SESSION_SECRET, loaders: overrides.loaders }))` (añadir `loaders?: Partial<Loaders>` a `AppOverrides`) **después** de `/api/auth` y **antes** del catch-all `/api/*`.

- [ ] **Step 3: Verificar y commit**

Run: `pnpm --filter @zenguy/admin typecheck && pnpm --filter @zenguy/admin test` → PASS.
```bash
git add apps/admin/src/server
git commit -m "admin: session-protected data endpoints"
```

---

## Parte D — `apps/admin`: SPA

### Task D1: Cliente base — API, sesión, router, login

**Files:**
- Create: `apps/admin/src/client/main.tsx`, `apps/admin/src/client/App.tsx`, `apps/admin/src/client/api.ts`, `apps/admin/src/client/styles/index.css`, `apps/admin/src/client/pages/LoginPage.tsx`, `apps/admin/src/client/lib/format.ts`, `apps/admin/src/client/lib/format.test.ts`, `apps/admin/src/client/pages/LoginPage.test.tsx`

**Interfaces:**
- `api.get<T>(path): Promise<T>` — `fetch(path, { credentials: "same-origin" })`; lanza `ApiError { status, code, message }`; el 401 en rutas de datos dispara `onUnauthorized` (redirección a `/login`).
- `api.login(email, password): Promise<{ email }>`, `api.logout()`, `api.me()`.
- `format.ts`: `relativeSeconds(from: number, now: number): string` ("3s ago"), `formatDuration(ms: number | null): string` ("1m 04s", "—"), `formatDateTime(ms: number): string` (locale en-GB, UTC-free: hora local del navegador), `percent(x: number | null): string` ("83%", "—").

- [ ] **Step 1: Tests de helpers puros (fallan primero)** — `lib/format.test.ts`:
```ts
import { formatDuration, percent, relativeSeconds } from "./format";
it("formats helper values", () => {
  expect(relativeSeconds(1_000, 4_500)).toBe("3s ago");
  expect(relativeSeconds(1_000, 125_000)).toBe("2m 4s ago");
  expect(relativeSeconds(0, 2 * 3_600_000 + 5_000)).toBe("2h 0m ago");
  expect(formatDuration(64_000)).toBe("1m 04s");
  expect(formatDuration(850)).toBe("0.9s");
  expect(formatDuration(null)).toBe("—");
  expect(percent(0.8333)).toBe("83%");
  expect(percent(null)).toBe("—");
});
```
`LoginPage.test.tsx` con `renderToStaticMarkup(<LoginForm error="Invalid credentials" pending={false} onSubmit={() => {}} />)`: contiene `Invalid credentials`, un `input[type=email]`, un `input[type=password]` y un botón "Sign in".

- [ ] **Step 2: Implementación**

`styles/index.css` (mismas reglas que el frontend; sin Newsreader):
```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --color-accent-50: #eef2ff; --color-accent-100: #e0e7ff; --color-accent-600: #4f46e5; --color-accent-700: #4338ca;
  --color-ok-50: #ecfdf5; --color-ok-600: #059669; --color-ok-700: #047857;
  --color-danger-50: #fef2f2; --color-danger-600: #dc2626; --color-danger-700: #b91c1c;
  --color-warn-50: #fffbeb; --color-warn-600: #d97706;
  --color-info-50: #eff6ff; --color-info-600: #2563eb;
}

@layer base {
  body { @apply bg-zinc-50 font-sans text-sm text-zinc-900 antialiased; }
  *:focus-visible { outline: 2px solid var(--color-accent-600); outline-offset: 2px; }
}
```

`api.ts`:
```ts
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) }, ...init });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: { code: string; message: string } } | null;
  if (!response.ok) throw new ApiError(response.status, payload?.error?.code ?? "UNKNOWN", payload?.error?.message ?? `HTTP ${response.status}`);
  return payload?.data as T;
}

export const api = {
  me: () => request<{ email: string }>("/api/auth/me"),
  login: (email: string, password: string) => request<{ email: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  overview: () => request<Overview>("/api/overview"),
  workers: () => request<WorkersResponse>("/api/workers"),
  users: () => request<{ users: UserSummary[] }>("/api/users?limit=50"),
  recentRuns: () => request<{ runs: RecentRun[] }>("/api/runs/recent?limit=50"),
};
```
(tipos importados de `../shared/types`).

`App.tsx`: `QueryClientProvider` + `BrowserRouter`; ruta `/login` → `LoginPage`; ruta `/` → `RequireSession` (usa `useQuery(["me"], api.me, { retry: false })`; mientras carga muestra "Checking session…"; si error 401 → `<Navigate to="/login" />`; si ok → `<DashboardPage email=… />`). Un `QueryCache` global con `onError`: si `ApiError.status === 401` fuera de `/login` → `window.location.assign("/login")`.

`LoginPage.tsx`: exporta `LoginForm({ error, pending, onSubmit })` puro (testeable) y `LoginPage` que usa `useMutation(api.login)`, navega a `/` al éxito y mapea errores: 401 → "Invalid credentials", 429 → "Too many attempts, try again later", 503 → "Production API is not reachable", otros → mensaje del error. Layout: tarjeta centrada `max-w-sm`, título "Zenguy Admin", subtítulo "Internal platform panel — sign in with your Zenguy account", inputs `h-9 border border-zinc-300 rounded-md px-3`, botón indigo `bg-accent-600 hover:bg-accent-700 text-white`.

`main.tsx`: `createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)` + `import "./styles/index.css"`.

- [ ] **Step 3: Verificar**

Run: `pnpm --filter @zenguy/admin typecheck && pnpm --filter @zenguy/admin test && pnpm --filter @zenguy/admin build` → PASS y `dist/client/index.html` generado.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/client apps/admin/index.html
git commit -m "admin: SPA shell with login and session gate"
```

### Task D2: Dashboard

**Files:**
- Create: `apps/admin/src/client/pages/DashboardPage.tsx`, `apps/admin/src/client/components/Card.tsx`, `apps/admin/src/client/components/KpiGrid.tsx`, `apps/admin/src/client/components/WorkersSection.tsx`, `apps/admin/src/client/components/RunsWindowsSection.tsx`, `apps/admin/src/client/components/UptimeSection.tsx`, `apps/admin/src/client/components/UsersTable.tsx`, `apps/admin/src/client/components/RecentRunsTable.tsx`, `apps/admin/src/client/components/StatusBadge.tsx`
- Test: `apps/admin/src/client/components/sections.test.tsx`

**Interfaces:** componentes puros que reciben datos (`Overview`, `WorkersResponse`, `UserSummary[]`, `RecentRun[]`, `now`) y `DashboardPage` que hace los `useQuery` con `refetchInterval`: workers 5 000, overview 30 000, runs 30 000, users 60 000.

- [ ] **Step 1: Tests de render (fallan primero)** — `sections.test.tsx` con `renderToStaticMarkup`:
  - `WorkersSection` con `{ unavailable: "MIGRATION_PENDING" }` → contiene "Pending production migration".
  - `WorkersSection` con `workers: []` → "No workers have reported yet".
  - `WorkersSection` con un worker online con `currentAttempt` → contiene "Online", el id, "Running Homepage" y el `runId`; un worker offline → "Offline" y "60s ago".
  - `RunsWindowsSection` con un `Overview` mock → muestra "1h", "3h", "24h", pass rate "50%" y "Next 24h".
  - `UsersTable` con 0 usuarios → "No users yet"; con 1 usuario sin `lastActiveAt` → "No activity".
  - `RecentRunsTable` con run `runnerId: "MIGRATION_PENDING"` → "pending".
  - `KpiGrid` muestra "Users", "Workspaces", "Active browser tests", "Monitors".

- [ ] **Step 2: Implementación** — reglas visuales del frontend: cards `bg-white border border-zinc-200 rounded-lg p-4`; contenedor `max-w-6xl mx-auto px-4 md:px-6 py-6`; títulos de sección `text-sm font-semibold text-zinc-900`; secundario `text-zinc-500`; tablas densas `py-2.5`; monospace para ids/versiones (`font-mono text-xs`). `StatusBadge`: PASSED/UP/Online → `bg-ok-50 text-ok-700`; FAILED/DOWN/Offline → `bg-danger-50 text-danger-700`; TIMEOUT/SYSTEM_ERROR → `bg-warn-50 text-warn-600`; QUEUED/RUNNING/UNKNOWN → `bg-zinc-100 text-zinc-600`. Cabecera del dashboard: "Zenguy Admin" + email + botón "Sign out" (`api.logout()` → navegar a `/login`) + "Production · updated Xs ago". Secciones en este orden: KPIs, Workers, Browser runs, Uptime, Recent runs, Users.

- [ ] **Step 3: Verificar**

Run: `pnpm --filter @zenguy/admin typecheck && pnpm --filter @zenguy/admin test && pnpm --filter @zenguy/admin build` → PASS. Smoke local: `pnpm --filter @zenguy/admin build && cd apps/admin && npx wrangler dev --port 8795 --var ADMIN_SESSION_SECRET:$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')` y `curl -s http://127.0.0.1:8795/api/auth/me` → 401 JSON; `curl -s http://127.0.0.1:8795/login | head -c 200` → HTML de la SPA.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/client
git commit -m "admin: dashboard sections (KPIs, workers, runs, uptime, users)"
```

---

## Parte E — Despliegue y entrega

### Task E1: Desplegar `zenguy-admin` en producción

- [ ] **Step 1: Build + deploy** (`wrangler` ya usa el perfil `zenguy-personal`):
```bash
pnpm --filter @zenguy/admin build
cd apps/admin && npx wrangler deploy
```
Esperado: Worker `zenguy-admin` publicado y custom domain `admin.zenguy.com` provisionado (DNS + cert en la zona `zenguy.com`).

- [ ] **Step 2: Secret de sesión**
```bash
cd apps/admin && python3 -c 'import secrets;print(secrets.token_urlsafe(48))' | npx wrangler secret put ADMIN_SESSION_SECRET
```

- [ ] **Step 3: Verificación externa**
```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://admin.zenguy.com/            # 200
curl -sS https://admin.zenguy.com/api/auth/me                                 # {"error":{"code":"UNAUTHORIZED",...}}
curl -sS -X POST https://admin.zenguy.com/api/auth/login -H 'content-type: application/json' -d '{"email":"nobody@example.com","password":"x"}'   # 401 Invalid credentials
curl -sS -I https://admin.zenguy.com/ | grep -i content-security-policy      # CSP presente
```
Login real: lo hace Marcos en el navegador con `marcos@aguayo.es` (no escribir su contraseña desde la automatización).

- [ ] **Step 4: README del admin** (`apps/admin/README.md`): qué es, cómo correr en local (`pnpm --filter @zenguy/admin dev` + `dev:worker`), variables/secrets, deploy manual, y el aviso de que lee la D1 de producción en solo lectura.

### Task E2: Entrega

- [ ] Commit final de docs (`docs/superpowers/plans/2026-08-23-admin-dashboard.md`, README).
- [ ] Gate completo: `pnpm --filter @zenguy/api typecheck && pnpm --filter @zenguy/api test && pnpm --filter @zenguy/api test:integration && pnpm --filter @zenguy/admin typecheck && pnpm --filter @zenguy/admin test && pnpm --filter @zenguy/admin test:integration && (cd runner && .venv/bin/python -m unittest test_browser_worker)`.
- [ ] Mensaje a Marcos (en español): estado, lo que ya está desplegado (admin), lo que necesita su `! git push origin main` (API: 0023 + heartbeat, vía CI) y el comando del VPS tras el push: `ssh root@142.132.220.44 'git -C /opt/projects/zenguy pull --ff-only && systemctl restart zenguy-fallback zenguy-fallback-staging'`, más reiniciar el worker del Mac. Hasta entonces el panel muestra "Pending production migration" en Workers.
- [ ] Actualizar memoria: nueva nota `zenguy-admin-panel.md` (Worker `zenguy-admin`, D1 prod en solo lectura, secret, deploy manual, allowlist).
