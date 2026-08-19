import { Hono } from "hono";
import { z } from "zod";
import { AuthenticateApiKey } from "../../application/api_keys/authenticate_api_key";
import { GetRun } from "../../application/browser_tests/get_run";
import { ListBrowserTests } from "../../application/browser_tests/list_browser_tests";
import { ListRuns } from "../../application/browser_tests/list_runs";
import type { RunSecretResolver } from "../../application/browser_tests/redact_run_output";
import { ListMonitors } from "../../application/uptime/list_monitors";
import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import type {
  AttemptRepo,
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { IncidentRepo } from "../../domain/incidents/repo";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { UserRepo } from "../../domain/users/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { rateLimit, type RateLimiter } from "../../shared/ratelimit";
import type { AppEnv } from "../env";
import { requireApiKey } from "../middleware/api_key_auth";
import { presentBrowserTest } from "../presenters/browser_test";
import { presentRun, presentRunListItem } from "../presenters/run";
import { presentMonitor } from "../presenters/uptime";
import { zquery } from "../validate";

export interface PublicApiRoutesDependencies {
  apiKeys: ApiKeyRepo;
  workspaces: WorkspaceRepo;
  users: UserRepo;
  monitors: MonitorRepo;
  incidents: IncidentRepo;
  tests: BrowserTestRepo;
  runs: RunRepo;
  attempts: AttemptRepo;
  rateLimiter: RateLimiter;
  resolveSecrets: RunSecretResolver;
  clock: Clock;
  config: Pick<AppConfig, "encryptionKey" | "artifactUrlSecret">;
}

const runStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "PASSED",
  "FAILED",
  "TIMEOUT",
  "SYSTEM_ERROR",
]);
const runsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  status: runStatusSchema.optional(),
});

// Read-only surface for workspace API keys (external apps and dashboards).
// Monitors are presented with the least-privileged MEMBER view so that
// admin-only configuration never leaks through a key.
export function publicApiRoutes(
  dependencies: PublicApiRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const authenticateApiKey = new AuthenticateApiKey(
    dependencies.apiKeys,
    dependencies.workspaces,
    dependencies.clock,
  );
  const apiKey = requireApiKey({ authenticateApiKey });
  const limited = rateLimit(
    dependencies.rateLimiter,
    (context) => `pubapi:${context.get("apiKey").id}`,
    RATE_LIMITS.public_api.limit,
    RATE_LIMITS.public_api.windowSeconds,
  );
  const listMonitors = new ListMonitors(
    dependencies.monitors,
    dependencies.incidents,
    dependencies.users,
    dependencies.config.encryptionKey,
  );
  const listBrowserTests = new ListBrowserTests(
    dependencies.tests,
    dependencies.runs,
    dependencies.users,
  );
  const listRuns = new ListRuns(
    dependencies.tests,
    dependencies.runs,
    dependencies.users,
  );
  const getRun = new GetRun(
    dependencies.runs,
    dependencies.attempts,
    dependencies.users,
    dependencies.config,
    dependencies.clock,
    dependencies.resolveSecrets,
  );

  app.get("/workspace", apiKey, limited, (context) => {
    const workspace = context.get("workspace");
    return context.json({
      data: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        timezone: workspace.timezone,
        createdAt: new Date(workspace.createdAt).toISOString(),
      },
    });
  });

  app.get("/uptime-monitors", apiKey, limited, async (context) => {
    const result = await listMonitors.execute({
      workspaceId: context.get("workspace").id,
      role: "MEMBER",
    });
    return context.json({ data: result.map(presentMonitor) });
  });

  app.get("/browser-tests", apiKey, limited, async (context) => {
    const result = await listBrowserTests.execute({
      workspaceId: context.get("workspace").id,
    });
    return context.json({ data: result.map(presentBrowserTest) });
  });

  app.get(
    "/browser-tests/:testId/runs",
    apiKey,
    limited,
    zquery(runsQuerySchema),
    async (context) => {
      const query = context.req.valid("query");
      const result = await listRuns.execute({
        workspaceId: context.get("workspace").id,
        testId: context.req.param("testId"),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
        ...(query.status === undefined ? {} : { status: query.status }),
      });
      return context.json({
        data: result.runs.map(presentRunListItem),
        nextCursor: result.nextCursor,
      });
    },
  );

  app.get("/runs/:runId", apiKey, limited, async (context) => {
    const result = await getRun.execute({
      workspaceId: context.get("workspace").id,
      runId: context.req.param("runId"),
    });
    return context.json({ data: presentRun(result) });
  });

  return app;
}
