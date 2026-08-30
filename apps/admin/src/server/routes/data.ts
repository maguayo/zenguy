import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../constants";
import { runCollection } from "../costs/collection";
import { loadCosts } from "../costs/costs";
import { loadMetrics } from "../db/metrics";
import { loadOverview } from "../db/overview";
import { loadRecentRuns } from "../db/runs";
import { loadUsers } from "../db/users";
import { loadWorkers } from "../db/workers";
import type { Costs, MetricRangeDays, UsageCollection } from "../../shared/types";
import type { AppEnv, Clock } from "../env";
import { AppError } from "../errors";
import { requireSession } from "../require_session";
import type { AdminSessionStore } from "../admin_sessions";
import type { AdminUserIds } from "../allowlist";

export interface Loaders {
  overview: typeof loadOverview;
  workers: typeof loadWorkers;
  users: typeof loadUsers;
  runs: typeof loadRecentRuns;
  metrics: typeof loadMetrics;
  costs: (db: D1Database, now: number, days: MetricRangeDays) => Promise<Costs>;
  /** Collects the last month of usage now; null when no analytics token is installed. */
  refreshUsage: (source: UsageCollection["source"]) => Promise<UsageCollection | null>;
}

export interface AnalyticsAccess {
  fetch: typeof fetch;
  token: string | undefined;
  accountId: string;
}

export interface DataRoutesDependencies {
  db: D1Database;
  clock: Clock;
  adminUserIds: AdminUserIds;
  sessions: AdminSessionStore;
  analytics: AnalyticsAccess;
  loaders?: Partial<Loaders>;
}

const MANUAL_REFRESH_DAYS = 30;

const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
});

const daysSchema = z.object({
  days: z
    .enum(["7", "30", "90"])
    .default("30")
    .transform((value) => Number(value) as MetricRangeDays),
});

const validateDays = zValidator("query", daysSchema, (result) => {
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "days must be 7, 30 or 90");
  }
});

const validateLimit = zValidator("query", limitSchema, (result) => {
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "limit must be an integer between 1 and 200");
  }
});

export function dataRoutes(deps: DataRoutesDependencies): Hono<AppEnv> {
  const collectorConfigured =
    deps.analytics.token !== undefined && deps.analytics.token.trim() !== "";
  const loaders: Loaders = {
    overview: loadOverview,
    workers: loadWorkers,
    users: loadUsers,
    runs: loadRecentRuns,
    metrics: loadMetrics,
    costs: (db, now, days) => loadCosts(db, now, days, collectorConfigured),
    refreshUsage: (source) =>
      runCollection(
        {
          db: deps.db,
          fetch: deps.analytics.fetch,
          token: deps.analytics.token,
          accountId: deps.analytics.accountId,
          clock: deps.clock,
        },
        { source, days: MANUAL_REFRESH_DAYS },
      ),
    ...deps.loaders,
  };
  // Guarded per route on purpose: a `use("*")` here would also match unknown
  // /api paths and answer 401 where the app answers 404.
  const guard = requireSession(deps);
  const app = new Hono<AppEnv>();

  app.get("/overview", guard, async (context) =>
    context.json({ data: await loaders.overview(deps.db, deps.clock.now()) }),
  );

  app.get("/workers", guard, async (context) =>
    context.json({ data: await loaders.workers(deps.db, deps.clock.now()) }),
  );

  app.get("/users", guard, validateLimit, async (context) =>
    context.json({
      data: { users: await loaders.users(deps.db, context.req.valid("query").limit) },
    }),
  );

  app.get("/runs/recent", guard, validateLimit, async (context) =>
    context.json({
      data: { runs: await loaders.runs(deps.db, context.req.valid("query").limit) },
    }),
  );

  app.get("/metrics", guard, validateDays, async (context) =>
    context.json({
      data: await loaders.metrics(deps.db, deps.clock.now(), context.req.valid("query").days),
    }),
  );

  app.get("/costs", guard, validateDays, async (context) =>
    context.json({
      data: await loaders.costs(deps.db, deps.clock.now(), context.req.valid("query").days),
    }),
  );

  // The one write the panel triggers on demand: it only touches the two
  // admin-owned usage tables, never product data.
  app.post("/costs/refresh", guard, async (context) => {
    const collection = await loaders.refreshUsage("manual");
    if (collection === null) {
      throw new AppError("SERVICE_UNAVAILABLE", "CF_ANALYTICS_API_TOKEN is not configured");
    }
    return context.json({ data: { collection } });
  });

  return app;
}
