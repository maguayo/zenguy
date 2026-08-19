import type { MiddlewareHandler } from "hono";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import { AppError } from "../../shared/errors";
import type { AppEnv } from "../env";

export function requireActiveSubscription(
  subscriptions: SubscriptionRepo,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const workspace = context.get("workspace");
    const subscription = await subscriptions.findByWorkspace(workspace.id);
    if (
      subscription?.status !== "ACTIVE" &&
      subscription?.status !== "PAST_DUE"
    ) {
      throw new AppError(
        "BILLING_REQUIRED",
        "This workspace needs an active subscription",
      );
    }
    await next();
  };
}
