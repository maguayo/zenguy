import { Hono } from "hono";
import type { ExternalRunner } from "../../application/execution/external_runner";
import {
  runnerClaimSchema,
  runnerCompleteSchema,
  runnerStaleClaimSchema,
  runnerStartSchema,
  runnerStepSchema,
} from "../../domain/browser_tests/runner_protocol";
import { timingSafeEqualText } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import type { AppEnv } from "../env";
import { zjson } from "../validate";

export interface RunnerRoutesDependencies {
  token: string;
  runner: Pick<
    ExternalRunner,
    "claim" | "claimStale" | "start" | "recordStep" | "complete"
  >;
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
    const provided = bearerToken(context.req.header("Authorization"));
    if (!(await timingSafeEqualText(provided, dependencies.token))) {
      throw new AppError("UNAUTHORIZED", "Invalid runner credentials");
    }
    await next();
    context.header("Cache-Control", "no-store");
  });

  app.post("/attempts/claim", zjson(runnerClaimSchema), async (context) => {
    const job = await dependencies.runner.claim(context.req.valid("json"));
    return context.json({
      data:
        job === null
          ? { disposition: "SKIP" as const }
          : { disposition: "EXECUTE" as const, job },
    });
  });

  app.post(
    "/attempts/claim-stale",
    zjson(runnerStaleClaimSchema),
    async (context) => {
      const job = await dependencies.runner.claimStale(
        context.req.valid("json"),
      );
      return context.json({
        data:
          job === null
            ? { disposition: "SKIP" as const }
            : { disposition: "EXECUTE" as const, job },
      });
    },
  );

  app.post("/attempts/:attemptId/start", zjson(runnerStartSchema), async (context) => {
    const { reference } = context.req.valid("json");
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

  app.post("/attempts/:attemptId/steps", zjson(runnerStepSchema), async (context) => {
    const input = context.req.valid("json");
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
