import { Hono } from "hono";
import { z } from "zod";
import type { TrackEvent } from "../../application/activity/track_event";
import { GetAlertsOverview } from "../../application/alerts/get_alerts_overview";
import { ListCreditEntries } from "../../application/alerts/list_credit_entries";
import { StartCreditTopUp } from "../../application/alerts/start_credit_topup";
import { UpdateAlertSettings } from "../../application/alerts/update_alert_settings";
import type { WriteAudit } from "../../application/audit/write_audit";
import type { AlertRepo } from "../../domain/alerts/repo";
import type { PaddleCheckoutIntentRepo } from "../../domain/billing/repo";
import { IssuePaddleCheckoutIntent } from "../../application/billing/paddle_checkout_intent";
import { quoteFor } from "../../domain/alerts/pricing";
import type { ChannelRepo } from "../../domain/channels/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import type { AppConfig } from "../../shared/config";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireAction, withWorkspace } from "../middleware/workspace";
import {
  presentAlertSettings,
  presentAlertsOverview,
  presentCreditEntry,
} from "../presenters/alerts";
import { zjson, zquery } from "../validate";

export interface AlertRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  channels: ChannelRepo;
  alerts: AlertRepo;
  checkoutIntents: PaddleCheckoutIntentRepo;
  audit: Pick<WriteAudit, "execute">;
  track?: Pick<TrackEvent, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret" | "encryptionKeys" | "paddle">;
}

const settingsSchema = z
  .object({
    paidChannelsEnabled: z.boolean().optional(),
    dailyPaidAlertLimit: z.number().int().optional(),
  })
  .refine(
    (input) =>
      input.paidChannelsEnabled !== undefined ||
      input.dailyPaidAlertLimit !== undefined,
    { message: "At least one field is required" },
  );
const quoteSchema = z.object({
  phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/u, "Enter an E.164 number"),
});
const entriesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const topUpSchema = z.object({ packs: z.number().int() });

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function alertCreditPriceId(
  paddle: AppConfig["paddle"],
): string | null {
  return paddle === null || paddle.alertCreditProductId === null
    ? null
    : paddle.alertCreditPriceId;
}

export function alertRoutes(
  dependencies: AlertRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const priceId = alertCreditPriceId(dependencies.config.paddle);
  const topUpAvailable = priceId !== null;
  const getOverview = new GetAlertsOverview(
    dependencies.alerts,
    dependencies.channels,
    dependencies.config.encryptionKeys,
    topUpAvailable,
    dependencies.clock,
  );
  const updateSettings = new UpdateAlertSettings(
    dependencies.alerts,
    dependencies.audit,
    topUpAvailable,
    dependencies.clock,
  );
  const listEntries = new ListCreditEntries(dependencies.alerts);
  const startTopUp = new StartCreditTopUp(
    new IssuePaddleCheckoutIntent(
      dependencies.checkoutIntents,
      dependencies.config.paddle,
      dependencies.clock,
      dependencies.ids,
      undefined,
      dependencies.track,
    ),
    dependencies.track,
  );

  app.get(
    "/:workspaceId/alerts",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await getOverview.execute({
        workspaceId: context.get("workspace").id,
        role: context.get("role"),
      });
      return context.json({ data: presentAlertsOverview(result) });
    },
  );

  app.patch(
    "/:workspaceId/alerts/settings",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("paid_alerts.manage"),
    zjson(settingsSchema),
    async (context) => {
      const result = await updateSettings.execute({
        ...context.req.valid("json"),
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.json({ data: presentAlertSettings(result) });
    },
  );

  app.get(
    "/:workspaceId/alerts/quote",
    auth,
    requireVerifiedEmail,
    workspace,
    zquery(quoteSchema),
    (context) => {
      const quote = quoteFor(context.req.valid("query").phoneNumber);
      return context.json({
        data: {
          destination: quote.destination,
          smsCents: quote.smsCents,
          callCents: quote.callCents,
          currency: "EUR",
        },
      });
    },
  );

  app.get(
    "/:workspaceId/alerts/credit/entries",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("billing.view"),
    zquery(entriesQuerySchema),
    async (context) => {
      const query = context.req.valid("query");
      const result = await listEntries.execute({
        workspaceId: context.get("workspace").id,
        role: context.get("role"),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      });
      return context.json({
        data: result.entries.map(presentCreditEntry),
        nextCursor: result.nextCursor,
      });
    },
  );

  app.post(
    "/:workspaceId/alerts/credit/topups",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("billing.manage"),
    zjson(topUpSchema),
    async (context) => {
      const result = await startTopUp.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        packs: context.req.valid("json").packs,
      });
      return context.json({ data: result }, 201);
    },
  );

  return app;
}
