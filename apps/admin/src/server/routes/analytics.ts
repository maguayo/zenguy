import { zValidator } from "@hono/zod-validator";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { loadAnalytics } from "../db/analytics";
import type { AppEnv, Clock } from "../env";
import { AppError } from "../errors";

export interface AnalyticsLoaders {
  analytics: typeof loadAnalytics;
}

export interface AnalyticsRoutesDependencies {
  db: D1Database;
  clock: Clock;
  /** The same session guard the data routes use; injected so app.ts builds it once. */
  guard: MiddlewareHandler<AppEnv>;
  loaders?: Partial<AnalyticsLoaders>;
}

// Three fixed ranges, so a 90 day scan is the widest query the panel can ask for.
const daysSchema = z.object({
  days: z.enum(["7", "30", "90"]).default("30").transform(Number),
});

const validateDays = zValidator("query", daysSchema, (result) => {
  if (!result.success) throw new AppError("VALIDATION_ERROR", "days must be 7, 30 or 90");
});

export function analyticsRoutes(deps: AnalyticsRoutesDependencies): Hono<AppEnv> {
  const loaders: AnalyticsLoaders = { analytics: loadAnalytics, ...deps.loaders };
  const app = new Hono<AppEnv>();

  app.get("/analytics", deps.guard, validateDays, async (context) =>
    context.json({
      data: await loaders.analytics(deps.db, deps.clock.now(), context.req.valid("query").days),
    }),
  );

  return app;
}
