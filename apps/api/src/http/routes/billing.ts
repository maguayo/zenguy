import { Hono } from "hono";
import type { TrackEvent } from "../../application/activity/track_event";
import { GetBilling } from "../../application/billing/get_billing";
import { GetCycleUsage } from "../../application/billing/get_cycle_usage";
import { GetInvoiceUrl } from "../../application/billing/get_invoice_url";
import type {
  PaddleCheckoutIntentRepo,
  SubscriptionRepo,
  UsageEventRepo,
} from "../../domain/billing/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { PaddleClient } from "../../infrastructure/paddle/client";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { IssuePaddleCheckoutIntent } from "../../application/billing/paddle_checkout_intent";
import type { AppConfig } from "../../shared/config";
import { unavailable } from "../../shared/errors";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireAction, withWorkspace } from "../middleware/workspace";
import { presentBilling } from "../presenters/billing";

export interface BillingRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  usageEvents: UsageEventRepo;
  checkoutIntents: PaddleCheckoutIntentRepo;
  paddle: PaddleClient;
  track?: Pick<TrackEvent, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret" | "paddle" | "complimentaryIssuerEmails">;
}

export function billingRoutes(
  dependencies: BillingRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const getCycleUsage = new GetCycleUsage(
    dependencies.subscriptions,
    dependencies.usageEvents,
    dependencies.clock,
  );
  const getBilling = new GetBilling(
    dependencies.subscriptions,
    getCycleUsage,
    dependencies.paddle,
  );
  const getInvoiceUrl = new GetInvoiceUrl(
    dependencies.subscriptions,
    dependencies.paddle,
  );
  const issueCheckout = new IssuePaddleCheckoutIntent(
    dependencies.checkoutIntents,
    dependencies.config.paddle,
    dependencies.clock,
    dependencies.ids,
    dependencies.subscriptions,
    dependencies.track,
  );

  app.get("/billing/config", auth, (context) => {
    const paddle = dependencies.config.paddle;
    const canIssueComplimentaryGrants =
      dependencies.config.complimentaryIssuerEmails.includes(
        context.get("user").email.trim().toLowerCase(),
      );
    if (paddle === null) {
      return context.json({
        data: {
          mode: "free" as const,
          canIssueComplimentaryGrants,
        },
      });
    }
    return context.json({
      data: {
        mode: "paddle" as const,
        environment: paddle.environment,
        clientToken: paddle.clientToken,
        priceId: paddle.priceId,
        canIssueComplimentaryGrants,
      },
    });
  });

  app.get(
    "/workspaces/:workspaceId/billing",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("billing.view"),
    async (context) => {
      const result = await getBilling.execute({
        workspaceId: context.get("workspace").id,
        role: context.get("role"),
      });
      return context.json({ data: presentBilling(result) });
    },
  );

  app.post(
    "/workspaces/:workspaceId/billing/checkout",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("billing.manage"),
    async (context) => {
      const result = await issueCheckout.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        purpose: "subscription",
      });
      return context.json({ data: result }, 201);
    },
  );

  app.get(
    "/workspaces/:workspaceId/billing/invoices/:transactionId/url",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("billing.view"),
    async (context) => {
      if (dependencies.config.paddle === null) {
        throw unavailable("Billing is not configured");
      }
      const result = await getInvoiceUrl.execute({
        workspaceId: context.get("workspace").id,
        role: context.get("role"),
        transactionId: context.req.param("transactionId"),
      });
      return context.json({ data: result });
    },
  );

  return app;
}
