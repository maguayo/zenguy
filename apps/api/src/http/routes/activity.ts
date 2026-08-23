import { Hono } from "hono";
import { z } from "zod";
import {
  IngestClientEvents,
  MAX_CLIENT_EVENTS_PER_BATCH,
} from "../../application/activity/ingest_client_events";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { UserRepo } from "../../domain/users/repo";
import type { MemberRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import type { IdGenerator } from "../../shared/ids";
import { sha256Hex } from "../../shared/crypto";
import {
  enforceRateLimitScopes,
  type RateLimiter,
} from "../../shared/ratelimit";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { zjson } from "../validate";

function normalizeAddress(value: string | undefined): string {
  if (value === undefined) return "unknown";
  const raw = value.trim().toLowerCase();
  return /^[0-9a-f:.]{1,64}$/iu.test(raw) ? raw : "invalid";
}

export interface ActivityRoutesDependencies {
  users: UserRepo;
  members: Pick<MemberRepo, "find">;
  activityEvents: Pick<ActivityEventRepo, "insertMany">;
  rateLimiter: RateLimiter;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret">;
}

// Same opt-in header the auth routes use: the iOS app sends it, browsers
// cannot (it is not in the CORS allow-list), so it decides `source`.
const NATIVE_CLIENT_HEADER = "X-Zenguy-Client";

// Clients only report scalars; route patterns and ids, never free-form data.
const propertyValue = z.union([z.string().max(200), z.number(), z.boolean()]);
const eventSchema = z.object({
  type: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64).optional(),
  resourceId: z.string().min(1).max(64).optional(),
  properties: z
    .record(z.string().max(40), propertyValue)
    .refine((value) => Object.keys(value).length <= 20, {
      message: "At most 20 properties",
    })
    .optional(),
});
const batchSchema = z.object({
  events: z
    .array(eventSchema)
    .min(1)
    .max(MAX_CLIENT_EVENTS_PER_BATCH)
    .refine(
      (events) =>
        new Set(
          events.flatMap((event) =>
            event.workspaceId === undefined ? [] : [event.workspaceId],
          ),
        ).size <= 5,
      { message: "At most 5 workspaces per batch" },
    ),
});

/**
 * Client-reported activity (page/screen visits), mounted under `/api/me`.
 * Verified users may post. Unknown types, server-only types and foreign
 * workspaces are dropped silently by the use case, never rejected.
 */
export function activityRoutes(
  dependencies: ActivityRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const ingest = new IngestClientEvents({
    activity: dependencies.activityEvents,
    members: dependencies.members,
    clock: dependencies.clock,
    ids: dependencies.ids,
  });

  app.post(
    "/events",
    requireAuth(dependencies),
    requireVerifiedEmail,
    async (context, next) => {
      const address = normalizeAddress(
        context.req.header("CF-Connecting-IP"),
      );
      const addressHash = await sha256Hex(address);
      await enforceRateLimitScopes(
        dependencies.rateLimiter,
        [
          `events:user:${context.get("user").id}`,
          `events:ip:${addressHash}`,
        ],
        RATE_LIMITS.events,
      );
      await enforceRateLimitScopes(
        dependencies.rateLimiter,
        [
          `events:daily:user:${context.get("user").id}`,
          `events:daily:ip:${addressHash}`,
        ],
        RATE_LIMITS.events_daily,
      );
      await enforceRateLimitScopes(
        dependencies.rateLimiter,
        ["events:daily:global"],
        RATE_LIMITS.events_global_daily,
      );
      await next();
    },
    zjson(batchSchema),
    async (context) => {
      const native =
        context.req.header(NATIVE_CLIENT_HEADER)?.trim().toLowerCase() ===
        "native";
      const result = await ingest.execute({
        userId: context.get("user").id,
        source: native ? "app" : "web",
        events: context.req.valid("json").events,
      });
      return context.json({ data: result }, 202);
    },
  );

  return app;
}
