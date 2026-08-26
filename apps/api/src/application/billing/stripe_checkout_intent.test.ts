import type { User } from "../../domain/users/types";
import type { StripeConfig } from "../../shared/config";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import { FakePaddleCheckoutIntentRepo } from "../../test/fakes/paddle_checkout_intents";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import type { CreateStripeCheckoutInput } from "../../infrastructure/stripe/client";
import {
  IssueStripeCheckoutIntent,
  STRIPE_CHECKOUT_INTENT_TTL_MS,
  STRIPE_CHECKOUT_SESSION_TTL_MS,
} from "./stripe_checkout_intent";

const NOW = Date.parse("2026-09-01T12:00:00Z");
const OWNER: User = {
  id: "usr_owner",
  name: "Owner",
  email: "owner@example.com",
  passwordHash: "hash",
  emailVerifiedAt: NOW,
  authVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
};
const CONFIG: StripeConfig = {
  secretKey: "sk_test_example123",
  webhookSecret: "whsec_example123",
  environment: "test",
  productId: "prod_monthly",
  priceId: "price_monthly",
  overagePriceId: "price_overage",
  alertCreditProductId: "prod_alert",
  alertCreditPriceId: "price_alert",
  apiBase: "https://api.stripe.com",
};

describe("IssueStripeCheckoutIntent", () => {
  it("persists a subscription authority and creates hosted Checkout server-side", async () => {
    const intents = new FakePaddleCheckoutIntentRepo();
    const calls: CreateStripeCheckoutInput[] = [];
    const useCase = new IssueStripeCheckoutIntent(
      intents,
      CONFIG,
      {
        createCheckoutSession: async (input) => {
          calls.push(input);
          return {
            id: "cs_test_1",
            url: "https://checkout.stripe.com/c/pay/cs_test_1",
          };
        },
      },
      "https://app.zenguy.com",
      new FixedClock(NOW),
      new FakeIds(),
      new FakeSubscriptionRepo(),
    );

    await expect(useCase.execute({
      workspaceId: "ws_1",
      actor: OWNER,
      actorRole: "OWNER",
      purpose: "subscription",
    })).resolves.toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      amountCents: 3_900,
      currencyCode: "EUR",
    });

    const intent = [...intents.intents.values()][0];
    expect(intent).toMatchObject({
      workspaceId: "ws_1",
      actorUserId: OWNER.id,
      purpose: "subscription",
      productId: "prod_monthly",
      priceId: "price_monthly",
      quantity: 1,
      amountCents: 3_900,
      expiresAt: NOW + STRIPE_CHECKOUT_INTENT_TTL_MS,
    });
    expect(calls).toEqual([expect.objectContaining({
      intentId: intent?.id,
      purpose: "subscription",
      customerEmail: OWNER.email,
      expiresAt: NOW + STRIPE_CHECKOUT_SESSION_TTL_MS,
      successUrl: "https://app.zenguy.com/w/ws_1/setup/billing?checkout=success",
      cancelUrl: "https://app.zenguy.com/w/ws_1/setup/billing?checkout=canceled",
    })]);
    expect(STRIPE_CHECKOUT_SESSION_TTL_MS).toBeGreaterThan(30 * 60 * 1_000);
  });

  it("pins top-up quantity, catalog and return URL", async () => {
    const intents = new FakePaddleCheckoutIntentRepo();
    const calls: CreateStripeCheckoutInput[] = [];
    const useCase = new IssueStripeCheckoutIntent(
      intents,
      CONFIG,
      {
        createCheckoutSession: async (input) => {
          calls.push(input);
          return {
            id: "cs_test_topup",
            url: "https://checkout.stripe.com/c/pay/cs_test_topup",
          };
        },
      },
      "https://app.zenguy.com",
      new FixedClock(NOW),
      new FakeIds(),
    );

    await expect(useCase.execute({
      workspaceId: "ws_1",
      actor: OWNER,
      actorRole: "OWNER",
      purpose: "alert_credit",
      quantity: 3,
    })).resolves.toMatchObject({ amountCents: 3_000, currencyCode: "EUR" });

    expect(calls[0]).toMatchObject({
      purpose: "alert_credit",
      priceId: "price_alert",
      quantity: 3,
      successUrl: "https://app.zenguy.com/w/ws_1/alerts/sms-calls?topup=success",
      cancelUrl: "https://app.zenguy.com/w/ws_1/alerts/sms-calls?topup=canceled",
    });
    expect([...intents.intents.values()][0]).toMatchObject({
      productId: "prod_alert",
      priceId: "price_alert",
      quantity: 3,
      amountCents: 3_000,
    });
  });
});
