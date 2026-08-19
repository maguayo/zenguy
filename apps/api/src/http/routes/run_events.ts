import { Hono } from "hono";
import { GetRun } from "../../application/browser_tests/get_run";
import type { RunSecretResolver } from "../../application/browser_tests/redact_run_output";
import type {
  AttemptRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { UserRepo } from "../../domain/users/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { hmacVerify } from "../../shared/crypto";
import { notFound } from "../../shared/errors";
import type { AppEnv } from "../env";
import { streamRunUpdates } from "../run_stream";
import { sseResponse } from "../sse";

export interface RunEventRoutesDependencies {
  runs: RunRepo;
  attempts: AttemptRepo;
  users: UserRepo;
  config: Pick<AppConfig, "artifactUrlSecret">;
  clock: Clock;
  resolveSecrets: RunSecretResolver;
}

export function runEventRoutes(
  dependencies: RunEventRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const getRun = new GetRun(
    dependencies.runs,
    dependencies.attempts,
    dependencies.users,
    dependencies.config,
    dependencies.clock,
    dependencies.resolveSecrets,
  );

  app.get("/:workspaceId/runs/:runId/events", async (context) => {
    const runId = context.req.param("runId");
    const exp = Number(context.req.query("exp"));
    const sig = context.req.query("sig") ?? "";
    const nowSeconds = Math.floor(dependencies.clock.now() / 1_000);
    if (
      !Number.isSafeInteger(exp) ||
      exp <= nowSeconds ||
      sig.length === 0 ||
      !(await hmacVerify(
        dependencies.config.artifactUrlSecret,
        `sse.${runId}.${exp}`,
        sig,
      ))
    ) {
      throw notFound("Run");
    }
    const input = {
      workspaceId: context.req.param("workspaceId"),
      runId,
    };
    // Resolve once before returning the stream so cross-workspace/missing runs
    // are regular JSON 404s rather than failures after an HTTP 200 has begun.
    const initial = await getRun.execute(input);
    return sseResponse(
      streamRunUpdates(
        { ...input, initial },
        { getRun, clock: dependencies.clock },
      ),
    );
  });

  return app;
}
