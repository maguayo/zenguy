import { Hono } from "hono";
import type { ExternalRunner } from "../../application/execution/external_runner";
import {
  runnerClaimSchema,
  runnerAuthorizeActionSchema,
  runnerCompleteSchema,
  runnerHeartbeatSchema,
  runnerStaleClaimSchema,
  runnerStartSchema,
  runnerStepSchema,
} from "../../domain/browser_tests/runner_protocol";
import type { RunnerWorkerRepo } from "../../domain/runners/repo";
import type { Clock } from "../../shared/clock";
import { timingSafeEqualText } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import type { AppEnv } from "../env";
import { zjson } from "../validate";
import {
  issueRunnerCapability,
  verifyRunnerCapability,
} from "../runner_capability";

export interface RunnerRoutesDependencies {
  environment: "development" | "staging" | "production";
  primaryToken: string;
  fallbackToken: string;
  /** Vacío = runner de Cloudflare Containers deshabilitado (fail-closed). */
  cfToken: string;
  capabilitySecret: string;
  runner: Pick<
    ExternalRunner,
    | "claim"
    | "claimStale"
    | "start"
    | "authorizeAction"
    | "recordStep"
    | "complete"
  >;
  workers: Pick<RunnerWorkerRepo, "recordHeartbeat">;
  clock: Clock;
}

function bearerToken(header: string | undefined): string {
  if (header === undefined || !header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}

export function runnerRoutes(
  dependencies: RunnerRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });

  async function requireBootstrap(
    provided: string,
    expected: string,
  ): Promise<void> {
    // Un token esperado ausente o demasiado corto nunca autoriza: sin este
    // guard, un modo sin token configurado aceptaría un bearer vacío.
    if (
      expected.length < 32 ||
      !(await timingSafeEqualText(provided, expected))
    ) {
      throw new AppError("UNAUTHORIZED", "Invalid runner credentials");
    }
  }

  /**
   * El modo se deriva exclusivamente del token presentado, nunca del payload.
   * `/attempts/claim` lo usan el worker primario (cola) y el runner de
   * Cloudflare Containers, cada uno con su token e identidad.
   */
  async function resolveClaimMode(provided: string): Promise<"local" | "cf"> {
    if (
      dependencies.primaryToken.length >= 32 &&
      (await timingSafeEqualText(provided, dependencies.primaryToken))
    ) {
      return "local";
    }
    if (
      dependencies.cfToken.length >= 32 &&
      (await timingSafeEqualText(provided, dependencies.cfToken))
    ) {
      return "cf";
    }
    throw new AppError("UNAUTHORIZED", "Invalid runner credentials");
  }

  async function requireCapability(
    provided: string,
    reference: Parameters<typeof verifyRunnerCapability>[2],
    workerId: string,
  ): Promise<void> {
    if (
      !(await verifyRunnerCapability(
        provided,
        dependencies.capabilitySecret,
        reference,
        workerId,
        dependencies.clock,
      ))
    ) {
      throw new AppError("UNAUTHORIZED", "Invalid runner credentials");
    }
  }

  function requireWorkerIdentity(
    workerId: string,
    mode: "local" | "fallback" | "cf",
  ): void {
    if (dependencies.environment === "development") return;
    const suffix =
      mode === "local" ? "primary" : mode === "fallback" ? "fallback" : "cf";
    const expected = `zenguy-${dependencies.environment}-${suffix}`;
    if (workerId !== expected) {
      throw new AppError("UNAUTHORIZED", "Invalid runner identity");
    }
  }

  app.use("/attempts/claim", async (context, next) => {
    await resolveClaimMode(bearerToken(context.req.header("Authorization")));
    await next();
  });

  app.use("/attempts/claim-stale", async (context, next) => {
    await requireBootstrap(
      bearerToken(context.req.header("Authorization")),
      dependencies.fallbackToken,
    );
    await next();
  });

  app.post("/heartbeat", zjson(runnerHeartbeatSchema), async (context) => {
    const heartbeat = context.req.valid("json");
    await requireBootstrap(
      bearerToken(context.req.header("Authorization")),
      heartbeat.mode === "local"
        ? dependencies.primaryToken
        : heartbeat.mode === "cf"
          ? dependencies.cfToken
          : dependencies.fallbackToken,
    );
    requireWorkerIdentity(heartbeat.workerId, heartbeat.mode);
    await dependencies.workers.recordHeartbeat(heartbeat, dependencies.clock.now());
    return context.json({ data: { ok: true } });
  });

  app.post("/attempts/claim", zjson(runnerClaimSchema), async (context) => {
    const input = context.req.valid("json");
    const mode = await resolveClaimMode(
      bearerToken(context.req.header("Authorization")),
    );
    requireWorkerIdentity(input.workerId, mode);
    const job = await dependencies.runner.claim(input);
    const capability =
      job === null
        ? null
        : await issueRunnerCapability(
            dependencies.capabilitySecret,
            job.reference,
            input.workerId,
            dependencies.clock,
          );
    return context.json({
      data:
        job === null
          ? { disposition: "SKIP" as const }
          : { disposition: "EXECUTE" as const, job: { ...job, capability } },
    });
  });

  app.post(
    "/attempts/claim-stale",
    zjson(runnerStaleClaimSchema),
    async (context) => {
      const input = context.req.valid("json");
      requireWorkerIdentity(input.workerId, "fallback");
      const job = await dependencies.runner.claimStale(input);
      const capability =
        job === null
          ? null
          : await issueRunnerCapability(
              dependencies.capabilitySecret,
              job.reference,
              input.workerId,
              dependencies.clock,
            );
      return context.json({
        data:
          job === null
            ? { disposition: "SKIP" as const }
            : { disposition: "EXECUTE" as const, job: { ...job, capability } },
      });
    },
  );

  app.post("/attempts/:attemptId/start", zjson(runnerStartSchema), async (context) => {
    const { reference } = context.req.valid("json");
    const workerId = context.req.header("X-Zenguy-Worker-Id") ?? "";
    await requireCapability(
      bearerToken(context.req.header("Authorization")),
      reference,
      workerId,
    );
    if (reference.attemptId !== context.req.param("attemptId")) {
      throw new AppError("CONFLICT", "Attempt reference does not match route");
    }
    const started = await dependencies.runner.start(reference);
    return context.json({
      data:
        started === null
          ? { disposition: "SKIP" as const }
          : { disposition: "STARTED" as const, ...started },
    });
  });

  app.post(
    "/attempts/:attemptId/actions/authorize",
    zjson(runnerAuthorizeActionSchema),
    async (context) => {
      const input = context.req.valid("json");
      const workerId = context.req.header("X-Zenguy-Worker-Id") ?? "";
      await requireCapability(
        bearerToken(context.req.header("Authorization")),
        input.reference,
        workerId,
      );
      if (input.reference.attemptId !== context.req.param("attemptId")) {
        throw new AppError("CONFLICT", "Attempt reference does not match route");
      }
      const authorized = await dependencies.runner.authorizeAction(input);
      return context.json({
        data: {
          disposition: authorized
            ? ("AUTHORIZED" as const)
            : ("BLOCKED" as const),
        },
      });
    },
  );

  app.post("/attempts/:attemptId/steps", zjson(runnerStepSchema), async (context) => {
    const input = context.req.valid("json");
    const workerId = context.req.header("X-Zenguy-Worker-Id") ?? "";
    await requireCapability(
      bearerToken(context.req.header("Authorization")),
      input.reference,
      workerId,
    );
    if (input.reference.attemptId !== context.req.param("attemptId")) {
      throw new AppError("CONFLICT", "Attempt reference does not match route");
    }
    const accepted = await dependencies.runner.recordStep(input);
    return context.json({
      data: { disposition: accepted ? ("ACCEPTED" as const) : ("SKIP" as const) },
    });
  });

  app.post(
    "/attempts/:attemptId/complete",
    zjson(runnerCompleteSchema),
    async (context) => {
      const { reference, outcome } = context.req.valid("json");
      const workerId = context.req.header("X-Zenguy-Worker-Id") ?? "";
      await requireCapability(
        bearerToken(context.req.header("Authorization")),
        reference,
        workerId,
      );
      if (reference.attemptId !== context.req.param("attemptId")) {
        throw new AppError("CONFLICT", "Attempt reference does not match route");
      }
      const accepted = await dependencies.runner.complete(reference, outcome);
      return context.json({
        data: {
          disposition: accepted ? ("COMPLETED" as const) : ("SKIP" as const),
        },
      });
    },
  );

  return app;
}
