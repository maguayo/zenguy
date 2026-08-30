import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import {
  ALERT_CREDIT_MAX_PACKS,
  ALERT_CREDIT_MIN_PACKS,
  ALERT_CREDIT_PACK_CENTS,
} from "../../domain/alerts/types";
import type {
  CheckoutIntentRepo,
  SubscriptionRepo,
} from "../../domain/billing/repo";
import type {
  BillingCurrency,
  CheckoutPurpose,
} from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { HttpStripeClient } from "../../infrastructure/stripe/client";
import type { Clock } from "../../shared/clock";
import type { StripeConfig } from "../../shared/config";
import { PLAN_PRICE_CENTS } from "../../shared/constants";
import { conflict, forbidden, unavailable, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { TrackEvent } from "../activity/track_event";

// Stripe requires expires_at to be at least 30 minutes after Session creation.
// Leave enough headroom for D1 and network latency before the API receives it.
export const STRIPE_CHECKOUT_SESSION_TTL_MS = 45 * 60 * 1_000;
export const STRIPE_CHECKOUT_INTENT_TTL_MS = 24 * 60 * 60 * 1_000;

export interface StripeCheckout {
  url: string;
  amountCents: number;
  currencyCode: BillingCurrency;
}

export class IssueStripeCheckoutIntent {
  constructor(
    private readonly intents: CheckoutIntentRepo,
    private readonly stripeConfig: StripeConfig | null,
    private readonly stripe: Pick<HttpStripeClient, "createCheckoutSession">,
    private readonly appUrl: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly subscriptions?: Pick<SubscriptionRepo, "findByWorkspace">,
    private readonly track?: Pick<TrackEvent, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    purpose: CheckoutPurpose;
    quantity?: number;
    currencyCode?: BillingCurrency;
  }): Promise<StripeCheckout> {
    if (!can(input.actorRole, "billing.manage")) throw forbidden();
    if (this.stripeConfig === null) throw unavailable("Billing is not configured");
    if (input.purpose === "subscription" && this.subscriptions !== undefined) {
      const current = await this.subscriptions.findByWorkspace(input.workspaceId);
      if (
        current?.providerSubscriptionId !== null &&
        current?.providerSubscriptionId !== undefined
      ) {
        throw conflict("Workspace already has a Stripe subscription");
      }
    }

    const quantity = input.purpose === "subscription" ? 1 : input.quantity;
    if (
      quantity === undefined ||
      !Number.isInteger(quantity) ||
      (input.purpose === "alert_credit" &&
        (quantity < ALERT_CREDIT_MIN_PACKS ||
          quantity > ALERT_CREDIT_MAX_PACKS))
    ) {
      throw validation([{
        field: "quantity",
        message: `Must be an integer between ${ALERT_CREDIT_MIN_PACKS} and ${ALERT_CREDIT_MAX_PACKS}`,
      }]);
    }
    const priceId =
      input.purpose === "subscription"
        ? this.stripeConfig.priceId
        : this.stripeConfig.alertCreditPriceId;
    const productId =
      input.purpose === "subscription"
        ? this.stripeConfig.productId
        : this.stripeConfig.alertCreditProductId;
    if (priceId === null || productId === null) {
      throw unavailable("Top-ups are not available yet");
    }
    const amountCents =
      (input.purpose === "subscription"
        ? PLAN_PRICE_CENTS
        : ALERT_CREDIT_PACK_CENTS) * quantity;
    // Alert credits remain on their existing EUR-only catalog. Only the
    // subscription Price is configured with EUR/USD currency options.
    const currencyCode: BillingCurrency =
      input.purpose === "subscription" ? (input.currencyCode ?? "EUR") : "EUR";
    const now = this.clock.now();
    const expiresAt = now + STRIPE_CHECKOUT_INTENT_TTL_MS;
    const sessionExpiresAt = now + STRIPE_CHECKOUT_SESSION_TTL_MS;
    const id = this.ids.newId("pci");
    await this.intents.insert({
      id,
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      purpose: input.purpose,
      productId,
      priceId,
      quantity,
      currencyCode,
      amountCents,
      createdAt: now,
      expiresAt,
      consumedAt: null,
      providerReference: null,
    });

    const returnPath =
      input.purpose === "subscription"
        ? `/w/${encodeURIComponent(input.workspaceId)}/setup/billing`
        : `/w/${encodeURIComponent(input.workspaceId)}/alerts/sms-calls`;
    const successUrl = new URL(returnPath, this.appUrl);
    successUrl.searchParams.set(
      input.purpose === "subscription" ? "checkout" : "topup",
      "success",
    );
    const cancelUrl = new URL(returnPath, this.appUrl);
    cancelUrl.searchParams.set(
      input.purpose === "subscription" ? "checkout" : "topup",
      "canceled",
    );
    const session = await this.stripe.createCheckoutSession({
      intentId: id,
      purpose: input.purpose,
      priceId,
      quantity,
      customerEmail: input.actor.email,
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
      expiresAt: sessionExpiresAt,
      currencyCode,
    });
    await this.track?.execute({
      type: ACTIVITY_EVENTS.billingCheckoutStarted,
      userId: input.actor.id,
      workspaceId: input.workspaceId,
      source: "server",
      properties: { kind: input.purpose },
    });
    return { url: session.url, amountCents, currencyCode };
  }
}
