import { Hono } from "hono";
import { z } from "zod";
import type { TrackEvent } from "../../application/activity/track_event";
import type { WriteAudit } from "../../application/audit/write_audit";
import { CreateMonitor } from "../../application/uptime/create_monitor";
import { DeleteMonitor } from "../../application/uptime/delete_monitor";
import type { CheckOutcome } from "../../application/uptime/execute_check";
import { GetMonitor } from "../../application/uptime/get_monitor";
import { GetMonitorStats } from "../../application/uptime/get_monitor_stats";
import { ListMonitors } from "../../application/uptime/list_monitors";
import { ListChecks } from "../../application/uptime/list_checks";
import { TestRequest } from "../../application/uptime/test_request";
import { UpdateMonitor } from "../../application/uptime/update_monitor";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import type {
  IncidentEventRepo,
  IncidentRepo,
} from "../../domain/incidents/repo";
import {
  monitorConfigSchema,
  monitorConfigUpdateSchema,
  type MonitorConfig,
} from "../../domain/uptime/rules";
import type { StatusPageItemRepo } from "../../domain/status_pages/repo";
import type { CheckRepo, MonitorRepo } from "../../domain/uptime/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import type { IdGenerator } from "../../shared/ids";
import { MAX_CURSOR_LENGTH } from "../../shared/pagination";
import type { RateLimiter } from "../../shared/ratelimit";
import { collectionCreateRateLimit } from "../../shared/ratelimit";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireActiveSubscription } from "../middleware/require_subscription";
import { requireAction, withWorkspace } from "../middleware/workspace";
import {
  presentCheck,
  presentMonitor,
  presentMonitorStats,
} from "../presenters/uptime";
import { zjson, zquery } from "../validate";

export interface UptimeRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  channels: ChannelRepo;
  monitors: MonitorRepo;
  checks: CheckRepo;
  incidents: IncidentRepo;
  incidentEvents: IncidentEventRepo;
  statusPageItems: Pick<StatusPageItemRepo, "removeForResource">;
  rateLimiter: RateLimiter;
  audit: Pick<WriteAudit, "execute">;
  track?: Pick<TrackEvent, "execute">;
  executeCheck: (
    config: MonitorConfig,
    workspaceId: string,
    execution?: { idempotencyKey?: string },
  ) => Promise<CheckOutcome>;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret" | "encryptionKeys">;
}

const updateSchema = monitorConfigUpdateSchema.refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required" },
);
const checksQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
const monitorsQuerySchema = z.object({
  cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function uptimeRoutes(
  dependencies: UptimeRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const active = requireActiveSubscription(
    dependencies.subscriptions,
    dependencies.clock,
  );
  const createMonitor = new CreateMonitor(
    dependencies.monitors,
    dependencies.channels,
    dependencies.subscriptions,
    dependencies.rateLimiter,
    dependencies.audit,
    dependencies.config.encryptionKeys,
    dependencies.clock,
    dependencies.ids,
  );
  const updateMonitor = new UpdateMonitor(
    dependencies.monitors,
    dependencies.channels,
    dependencies.incidents,
    dependencies.subscriptions,
    dependencies.users,
    dependencies.audit,
    dependencies.config.encryptionKeys,
    dependencies.clock,
  );
  const deleteMonitor = new DeleteMonitor(
    dependencies.monitors,
    dependencies.incidents,
    dependencies.incidentEvents,
    dependencies.statusPageItems,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
    dependencies.ids,
  );
  const getMonitor = new GetMonitor(
    dependencies.monitors,
    dependencies.incidents,
    dependencies.users,
    dependencies.config.encryptionKeys,
  );
  const listMonitors = new ListMonitors(
    dependencies.monitors,
    dependencies.incidents,
    dependencies.users,
    dependencies.config.encryptionKeys,
  );
  const listChecks = new ListChecks(dependencies.monitors, dependencies.checks);
  const getMonitorStats = new GetMonitorStats(
    dependencies.monitors,
    dependencies.checks,
    dependencies.incidents,
    dependencies.clock,
  );
  const testRequest = new TestRequest(
    dependencies.channels,
    dependencies.subscriptions,
    dependencies.rateLimiter,
    dependencies.executeCheck,
    dependencies.track,
  );
  const commonCreateLimit = collectionCreateRateLimit(
    dependencies.rateLimiter,
  );

  app.get(
    "/:workspaceId/uptime-monitors",
    auth,
    requireVerifiedEmail,
    workspace,
    zquery(monitorsQuerySchema),
    async (context) => {
      const query = context.req.valid("query");
      const result = await listMonitors.execute({
        workspaceId: context.get("workspace").id,
        role: context.get("role"),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      });
      return context.json({
        data: result.monitors.map(presentMonitor),
        nextCursor: result.nextCursor,
      });
    },
  );

  app.post(
    "/:workspaceId/uptime-monitors/test-request",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("uptime.manage"),
    active,
    zjson(z.unknown()),
    async (context) => {
      const result = await testRequest.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        config: context.req.valid("json"),
        ip: requestIp(context),
      });
      return context.json({ data: result });
    },
  );

  app.post(
    "/:workspaceId/uptime-monitors",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("uptime.manage"),
    active,
    commonCreateLimit,
    zjson(monitorConfigSchema),
    async (context) => {
      const result = await createMonitor.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        config: context.req.valid("json"),
        ip: requestIp(context),
      });
      return context.json({ data: presentMonitor(result) }, 201);
    },
  );

  app.get(
    "/:workspaceId/uptime-monitors/:monitorId/checks",
    auth,
    requireVerifiedEmail,
    workspace,
    zquery(checksQuerySchema),
    async (context) => {
      const query = context.req.valid("query");
      const result = await listChecks.execute({
        workspaceId: context.get("workspace").id,
        monitorId: context.req.param("monitorId"),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      });
      return context.json({
        data: result.checks.map(presentCheck),
        nextCursor: result.nextCursor,
      });
    },
  );

  app.get(
    "/:workspaceId/uptime-monitors/:monitorId/stats",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await getMonitorStats.execute({
        workspaceId: context.get("workspace").id,
        monitorId: context.req.param("monitorId"),
      });
      return context.json({ data: presentMonitorStats(result) });
    },
  );

  app.get(
    "/:workspaceId/uptime-monitors/:monitorId",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await getMonitor.execute({
        workspaceId: context.get("workspace").id,
        monitorId: context.req.param("monitorId"),
        role: context.get("role"),
      });
      return context.json({ data: presentMonitor(result) });
    },
  );

  app.patch(
    "/:workspaceId/uptime-monitors/:monitorId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("uptime.manage"),
    active,
    zjson(updateSchema),
    async (context) => {
      const result = await updateMonitor.execute({
        workspaceId: context.get("workspace").id,
        monitorId: context.req.param("monitorId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        changes: context.req.valid("json"),
        ip: requestIp(context),
      });
      return context.json({ data: presentMonitor(result) });
    },
  );

  app.delete(
    "/:workspaceId/uptime-monitors/:monitorId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("uptime.manage"),
    active,
    async (context) => {
      await deleteMonitor.execute({
        workspaceId: context.get("workspace").id,
        monitorId: context.req.param("monitorId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.body(null, 204);
    },
  );

  return app;
}
