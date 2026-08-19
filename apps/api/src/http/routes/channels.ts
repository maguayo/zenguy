import { Hono } from "hono";
import { z } from "zod";
import type { WriteAudit } from "../../application/audit/write_audit";
import { CreateChannel } from "../../application/channels/create_channel";
import { DeleteChannel } from "../../application/channels/delete_channel";
import { ListChannels } from "../../application/channels/list_channels";
import { ListDeliveries } from "../../application/channels/list_deliveries";
import { TestChannel } from "../../application/channels/test_channel";
import { UpdateChannel } from "../../application/channels/update_channel";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  ChannelRepo,
  DeliveryRepo,
} from "../../domain/channels/repo";
import type { ChannelSender } from "../../domain/channels/notifier";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import type { IdGenerator } from "../../shared/ids";
import type { RateLimiter } from "../../shared/ratelimit";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireActiveSubscription } from "../middleware/require_subscription";
import { requireAction, withWorkspace } from "../middleware/workspace";
import { presentChannel, presentDelivery } from "../presenters/channel";
import { zjson, zquery } from "../validate";

export interface ChannelRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  channels: ChannelRepo;
  deliveries: DeliveryRepo;
  sender: ChannelSender;
  rateLimiter: RateLimiter;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "appUrl" | "jwtSecret" | "encryptionKey">;
}

const channelTypeSchema = z.enum([
  "EMAIL",
  "SMS",
  "WHATSAPP",
  "CALL",
  "SLACK",
  "DISCORD",
]);
const requiredConfig = z.unknown().refine((value) => value !== undefined, {
  message: "Required",
});
const createSchema = z.object({
  name: z.string(),
  type: channelTypeSchema,
  config: requiredConfig,
});
const updateSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    config: z.unknown().optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.enabled !== undefined ||
      input.config !== undefined,
    { message: "At least one field is required" },
  );
const deliveriesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function channelRoutes(
  dependencies: ChannelRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const active = requireActiveSubscription(dependencies.subscriptions);
  const createChannel = new CreateChannel(
    dependencies.channels,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.config.encryptionKey,
    dependencies.clock,
    dependencies.ids,
  );
  const updateChannel = new UpdateChannel(
    dependencies.channels,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.config.encryptionKey,
    dependencies.clock,
  );
  const deleteChannel = new DeleteChannel(
    dependencies.channels,
    dependencies.subscriptions,
    dependencies.audit,
  );
  const testChannel = new TestChannel(
    dependencies.channels,
    dependencies.deliveries,
    dependencies.subscriptions,
    dependencies.sender,
    dependencies.rateLimiter,
    dependencies.audit,
    dependencies.config,
    dependencies.clock,
    dependencies.ids,
  );
  const listChannels = new ListChannels(
    dependencies.channels,
    dependencies.config.encryptionKey,
  );
  const listDeliveries = new ListDeliveries(
    dependencies.channels,
    dependencies.deliveries,
  );

  app.get(
    "/:workspaceId/channels",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await listChannels.execute({
        workspaceId: context.get("workspace").id,
      });
      return context.json({ data: result.map(presentChannel) });
    },
  );

  app.post(
    "/:workspaceId/channels",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("channels.manage"),
    active,
    zjson(createSchema),
    async (context) => {
      const result = await createChannel.execute({
        ...context.req.valid("json"),
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.json({ data: presentChannel(result) }, 201);
    },
  );

  app.patch(
    "/:workspaceId/channels/:channelId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("channels.manage"),
    active,
    zjson(updateSchema),
    async (context) => {
      const result = await updateChannel.execute({
        ...context.req.valid("json"),
        workspaceId: context.get("workspace").id,
        channelId: context.req.param("channelId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.json({ data: presentChannel(result) });
    },
  );

  app.delete(
    "/:workspaceId/channels/:channelId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("channels.manage"),
    active,
    async (context) => {
      await deleteChannel.execute({
        workspaceId: context.get("workspace").id,
        channelId: context.req.param("channelId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.body(null, 204);
    },
  );

  app.post(
    "/:workspaceId/channels/:channelId/test",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("channels.manage"),
    active,
    async (context) => {
      const currentWorkspace = context.get("workspace");
      const result = await testChannel.execute({
        workspaceId: currentWorkspace.id,
        workspaceName: currentWorkspace.name,
        channelId: context.req.param("channelId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.json({ data: { delivery: presentDelivery(result) } });
    },
  );

  app.get(
    "/:workspaceId/channels/:channelId/deliveries",
    auth,
    requireVerifiedEmail,
    workspace,
    zquery(deliveriesQuerySchema),
    async (context) => {
      const query = context.req.valid("query");
      const result = await listDeliveries.execute({
        workspaceId: context.get("workspace").id,
        channelId: context.req.param("channelId"),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      });
      return context.json({
        data: result.deliveries.map(presentDelivery),
        nextCursor: result.nextCursor,
      });
    },
  );

  return app;
}
