import type { MiddlewareHandler } from "hono";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import { ensureActiveSubscription } from "../../application/billing/ensure_active_subscription";
import { systemClock, type Clock } from "../../shared/clock";
import type { AppEnv } from "../env";

export function requireActiveSubscription(
  subscriptions: SubscriptionRepo,
  clock: Clock = systemClock,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const workspace = context.get("workspace");
    await ensureActiveSubscription(subscriptions, workspace.id, clock.now());
    await next();
  };
}
