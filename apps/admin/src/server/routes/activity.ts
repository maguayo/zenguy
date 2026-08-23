import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../constants";
import { loadActivityFeed } from "../db/activity";
import { loadWorkspaces } from "../db/workspaces";
import type { AppEnv } from "../env";
import { AppError } from "../errors";
import { requireSession } from "../require_session";
import type { DataRoutesDependencies } from "./data";

export interface ActivityLoaders {
  activity: typeof loadActivityFeed;
  workspaces: typeof loadWorkspaces;
}

/**
 * The same dependency object the data routes receive; its `loaders` may also
 * carry activity fakes, which is how tests swap the D1 loaders out.
 */
export type ActivityRoutesDependencies = DataRoutesDependencies & {
  loaders?: Partial<ActivityLoaders>;
};

// Event types are `<subject>.<verb_past_tense>` in snake_case (see the API
// catalog). The filter is only ever bound as a parameter, so this merely keeps
// garbage out of the query log.
const MAX_EVENT_TYPE_LENGTH = 64;
const EVENT_TYPE_PATTERN = /^[a-z_]+\.[a-z_]+$/u;

const LIMIT_MESSAGE = `limit must be an integer between 1 and ${MAX_LIST_LIMIT}`;
const TYPE_MESSAGE =
  "type must be an event type such as alert.sent " +
  `(lowercase letters, underscores, one dot, at most ${MAX_EVENT_TYPE_LENGTH} characters)`;

const limitField = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_LIST_LIMIT)
  .default(DEFAULT_LIST_LIMIT);
const feedQuerySchema = z.object({
  limit: limitField,
  type: z.string().regex(EVENT_TYPE_PATTERN).max(MAX_EVENT_TYPE_LENGTH).optional(),
});
const limitQuerySchema = z.object({ limit: limitField });

// Shared by both validators; the first issue decides which field to blame.
function rejectInvalidQuery(result: {
  success: boolean;
  error?: { issues: ReadonlyArray<{ path: PropertyKey[] }> };
}): void {
  if (!result.success) {
    const field = result.error?.issues[0]?.path[0];
    throw new AppError("VALIDATION_ERROR", field === "type" ? TYPE_MESSAGE : LIMIT_MESSAGE);
  }
}

const validateFeedQuery = zValidator("query", feedQuerySchema, rejectInvalidQuery);
const validateLimitQuery = zValidator("query", limitQuerySchema, rejectInvalidQuery);

export function activityRoutes(deps: ActivityRoutesDependencies): Hono<AppEnv> {
  const loaders: ActivityLoaders = {
    activity: loadActivityFeed,
    workspaces: loadWorkspaces,
    ...deps.loaders,
  };
  // Guarded per route, like the data routes, so unknown /api paths keep
  // answering 404 rather than 401.
  const guard = requireSession(deps);
  const app = new Hono<AppEnv>();

  app.get("/activity", guard, validateFeedQuery, async (context) => {
    const query = context.req.valid("query");
    return context.json({
      data: await loaders.activity(deps.db, query.limit, query.type ?? null),
    });
  });

  app.get("/workspaces", guard, validateLimitQuery, async (context) =>
    context.json({
      data: await loaders.workspaces(deps.db, context.req.valid("query").limit),
    }),
  );

  return app;
}
