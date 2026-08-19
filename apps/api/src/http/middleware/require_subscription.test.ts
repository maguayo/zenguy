import { Hono } from "hono";
import type { Subscription } from "../../domain/billing/types";
import type { Workspace } from "../../domain/workspaces/types";
import { errorHandler } from "./error_handler";
import type { AppEnv } from "../env";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import { requireActiveSubscription } from "./require_subscription";

const WORKSPACE: Workspace = {
  id: "ws_gate",
  name: "Gate",
  slug: "gate",
  timezone: "UTC",
  ownerUserId: "usr_owner",
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

function subscription(status: Subscription["status"]): Subscription {
  return {
    id: "sub_gate",
    workspaceId: WORKSPACE.id,
    provider: "paddle",
    providerCustomerId: null,
    providerSubscriptionId: null,
    status,
    periodStart: null,
    periodEnd: null,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function probe(status: Subscription["status"] | null) {
  const subscriptions = new FakeSubscriptionRepo();
  if (status !== null) {
    await subscriptions.upsertByWorkspace(subscription(status));
  }
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.use("/probe", async (context, next) => {
    context.set("workspace", WORKSPACE);
    await next();
  });
  app.get("/probe", requireActiveSubscription(subscriptions), (context) =>
    context.json({ data: { allowed: true } }),
  );
  return app.request("/probe");
}

describe("requireActiveSubscription", () => {
  it.each([null, "NONE", "CANCELED"] as const)(
    "blocks %s subscription state",
    async (status) => {
      const response = await probe(status);

      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "BILLING_REQUIRED",
          message: "This workspace needs an active subscription",
        },
      });
    },
  );

  it.each(["ACTIVE", "PAST_DUE"] as const)(
    "allows %s subscription state",
    async (status) => {
      const response = await probe(status);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { allowed: true },
      });
    },
  );
});
