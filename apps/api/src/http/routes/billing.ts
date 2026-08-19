import { Hono } from "hono";
import { GetBilling } from "../../application/billing/get_billing";
import { GetCycleUsage } from "../../application/billing/get_cycle_usage";
import { GetInvoiceUrl } from "../../application/billing/get_invoice_url";
import type {
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
import type { AppConfig } from "../../shared/config";
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
  paddle: PaddleClient;
  clock: Clock;
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

  app.get("/billing/config", auth, (context) =>
    context.json({
      data: {
        environment: dependencies.config.paddle.environment,
        clientToken: dependencies.config.paddle.clientToken,
        priceId: dependencies.config.paddle.priceId,
        canIssueComplimentaryGrants:
          dependencies.config.complimentaryIssuerEmails.includes(
            context.get("user").email.trim().toLowerCase(),
          ),
      },
    }),
  );

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

  app.get(
    "/workspaces/:workspaceId/billing/invoices/:transactionId/url",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("billing.view"),
    async (context) => {
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
