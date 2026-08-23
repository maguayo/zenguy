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
import type { AdminSessionStore } from "../admin_sessions";
import type { AdminUserIds } from "../allowlist";

export interface Loaders {
  overview: typeof loadOverview;
  workers: typeof loadWorkers;
  users: typeof loadUsers;
  runs: typeof loadRecentRuns;
}

export interface DataRoutesDependencies {
  db: D1Database;
  clock: Clock;
  adminUserIds: AdminUserIds;
  sessions: AdminSessionStore;
  loaders?: Partial<Loaders>;
}

const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
});

const validateLimit = zValidator("query", limitSchema, (result) => {
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "limit must be an integer between 1 and 200");
  }
});

export function dataRoutes(deps: DataRoutesDependencies): Hono<AppEnv> {
  const loaders: Loaders = {
    overview: loadOverview,
    workers: loadWorkers,
    users: loadUsers,
    runs: loadRecentRuns,
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

  return app;
}
