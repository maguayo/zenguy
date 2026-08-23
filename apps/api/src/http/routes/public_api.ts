import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { TrackEvent } from "../../application/activity/track_event";
import { AuthenticateApiKey } from "../../application/api_keys/authenticate_api_key";
import { GetRun } from "../../application/browser_tests/get_run";
import { ListBrowserTests } from "../../application/browser_tests/list_browser_tests";
import { ListRuns } from "../../application/browser_tests/list_runs";
import type { RunSecretResolver } from "../../application/browser_tests/redact_run_output";
import { ListMonitors } from "../../application/uptime/list_monitors";
import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import type { ApiKeyScope } from "../../domain/api_keys/types";
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
import { sha256Hex } from "../../shared/crypto";
import { AppError, forbidden } from "../../shared/errors";
import { RATE_LIMITS } from "../../shared/constants";
import { rateLimit, type RateLimiter } from "../../shared/ratelimit";
import { MAX_CURSOR_LENGTH } from "../../shared/pagination";
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
  track?: Pick<TrackEvent, "execute">;
  clock: Clock;
  config: Pick<AppConfig, "encryptionKeys" | "artifactUrlSecret">;
}

const API_KEY_USE_ACTIVITY_INTERVAL_MS = 15 * 60_000;

/**
 * `api_key.used` is throttled per key: the first use and any use more than
 * fifteen minutes after the previous one are recorded, the rest are not.
 * `lastUsedAt` must be the value read before `touchLastUsed` runs.
 */
export function shouldRecordApiKeyUse(
  lastUsedAt: number | null,
  now: number,
): boolean {
  return lastUsedAt === null || now - lastUsedAt > API_KEY_USE_ACTIVITY_INTERVAL_MS;
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
  cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  status: runStatusSchema.optional(),
});
const browserTestsQuerySchema = z.object({
  cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
const monitorsQuerySchema = z.object({
  cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
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
  const preAuthLimited: MiddlewareHandler<AppEnv> = async (context, next) => {
    const address = context.req.header("CF-Connecting-IP") ?? "unknown";
    const addressHash = await sha256Hex(address.slice(0, 128).toLowerCase());
    const result = await dependencies.rateLimiter.hit(
      `pubapi:preauth:${addressHash}`,
      RATE_LIMITS.public_api.limit,
      RATE_LIMITS.public_api.windowSeconds,
    );
    if (!result.allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many requests",
        undefined,
        result.retryAfterSeconds,
      );
    }
    await next();
  };
  const limited = rateLimit(
    dependencies.rateLimiter,
    (context) => `pubapi:${context.get("apiKey").id}`,
    RATE_LIMITS.public_api.limit,
    RATE_LIMITS.public_api.windowSeconds,
  );
  const requireScope = (scope: ApiKeyScope): MiddlewareHandler<AppEnv> =>
    async (context, next) => {
      if (!context.get("apiKey").scopes.includes(scope)) {
        throw forbidden(`API key lacks required scope: ${scope}`);
      }
      await next();
    };
  // Deliberately record usage only after the abuse limiter and scope check.
  // Rejected traffic must not amplify into a D1 write per request.
  const recordUse: MiddlewareHandler<AppEnv> = async (context, next) => {
    const apiKey = context.get("apiKey");
    const now = dependencies.clock.now();
    await dependencies.apiKeys.touchLastUsed(apiKey.id, now);
    if (shouldRecordApiKeyUse(apiKey.lastUsedAt, now)) {
      await dependencies.track?.execute({
        type: ACTIVITY_EVENTS.apiKeyUsed,
        userId: null,
        workspaceId: apiKey.workspaceId,
        source: "api",
        resourceId: apiKey.id,
      });
    }
    await next();
  };
  const listMonitors = new ListMonitors(
    dependencies.monitors,
    dependencies.incidents,
    dependencies.users,
    dependencies.config.encryptionKeys,
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

  app.get(
    "/workspace",
    preAuthLimited,
    apiKey,
    limited,
    requireScope("workspace:read"),
    recordUse,
    (context) => {
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
    },
  );

  app.get(
    "/uptime-monitors",
    preAuthLimited,
    apiKey,
    limited,
    requireScope("uptime:read"),
    zquery(monitorsQuerySchema),
    recordUse,
    async (context) => {
      const query = context.req.valid("query");
      const result = await listMonitors.execute({
        workspaceId: context.get("workspace").id,
        role: "MEMBER",
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      });
      return context.json({
        data: result.monitors.map(presentMonitor),
        nextCursor: result.nextCursor,
      });
    },
  );

  app.get(
    "/browser-tests",
    preAuthLimited,
    apiKey,
    limited,
    requireScope("tests:read"),
    zquery(browserTestsQuerySchema),
    recordUse,
    async (context) => {
      const query = context.req.valid("query");
      const result = await listBrowserTests.execute({
        workspaceId: context.get("workspace").id,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      });
      return context.json({
        data: result.tests.map(presentBrowserTest),
        nextCursor: result.nextCursor,
      });
    },
  );

  app.get(
    "/browser-tests/:testId/runs",
    preAuthLimited,
    apiKey,
    limited,
    requireScope("runs:read"),
    zquery(runsQuerySchema),
    recordUse,
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

  app.get(
    "/runs/:runId",
    preAuthLimited,
    apiKey,
    limited,
    requireScope("runs:read"),
    recordUse,
    async (context) => {
      const result = await getRun.execute({
        workspaceId: context.get("workspace").id,
        runId: context.req.param("runId"),
      });
      return context.json({ data: presentRun(result) });
    },
  );

  return app;
}
