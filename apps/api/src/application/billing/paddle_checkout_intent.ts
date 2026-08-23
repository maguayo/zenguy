import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type {
  PaddleCheckoutIntentRepo,
  SubscriptionRepo,
} from "../../domain/billing/repo";
import type { PaddleCheckoutPurpose } from "../../domain/billing/types";
import {
  ALERT_CREDIT_MAX_PACKS,
  ALERT_CREDIT_MIN_PACKS,
  ALERT_CREDIT_PACK_CENTS,
} from "../../domain/alerts/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import type { PaddleConfig } from "../../shared/config";
import { PLAN_PRICE_CENTS } from "../../shared/constants";
import { hmacSign, hmacVerify } from "../../shared/crypto";
import { conflict, forbidden, unavailable, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { TrackEvent } from "../activity/track_event";

export const PADDLE_CHECKOUT_INTENT_TTL_MS = 15 * 60 * 1_000;

export interface PaddleCheckoutCustomData {
  checkout_intent_id: string;
  checkout_intent_sig: string;
}

export interface PaddleCheckout {
  priceId: string;
  quantity: number;
  amountCents: number;
  currencyCode: "EUR";
  customData: PaddleCheckoutCustomData;
}

function signaturePayload(id: string): string {
  return `zenguy:paddle-checkout-intent:v1:${id}`;
}

export async function verifyPaddleIntentReference(
  secret: string,
  data: unknown,
): Promise<string | null> {
  if (data === null || typeof data !== "object") return null;
  const id = Reflect.get(data, "checkout_intent_id");
  const signature = Reflect.get(data, "checkout_intent_sig");
  if (typeof id !== "string" || typeof signature !== "string") return null;
  return (await hmacVerify(secret, signaturePayload(id), signature)) ? id : null;
}

export class IssuePaddleCheckoutIntent {
  constructor(
    private readonly intents: PaddleCheckoutIntentRepo,
    private readonly paddle: PaddleConfig | null,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly subscriptions?: Pick<SubscriptionRepo, "findByWorkspace">,
    private readonly track?: Pick<TrackEvent, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    purpose: PaddleCheckoutPurpose;
    quantity?: number;
  }): Promise<PaddleCheckout> {
    if (!can(input.actorRole, "billing.manage")) throw forbidden();
    if (this.paddle === null) throw unavailable("Billing is not configured");
    if (input.purpose === "subscription" && this.subscriptions !== undefined) {
      const current = await this.subscriptions.findByWorkspace(input.workspaceId);
      if (current?.providerSubscriptionId !== null && current?.providerSubscriptionId !== undefined) {
        throw conflict("Workspace already has a Paddle subscription");
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
      throw validation([
        {
          field: "quantity",
          message: `Must be an integer between ${ALERT_CREDIT_MIN_PACKS} and ${ALERT_CREDIT_MAX_PACKS}`,
        },
      ]);
    }
    const priceId =
      input.purpose === "subscription"
        ? this.paddle.priceId
        : this.paddle.alertCreditPriceId;
    const productId =
      input.purpose === "subscription"
        ? this.paddle.productId
        : this.paddle.alertCreditProductId;
    if (priceId === null || productId === null) {
      throw unavailable("Top-ups are not available yet");
    }
    const unitCents =
      input.purpose === "subscription"
        ? PLAN_PRICE_CENTS
        : ALERT_CREDIT_PACK_CENTS;
    const now = this.clock.now();
    const id = this.ids.newId("pci");
    await this.intents.insert({
      id,
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      purpose: input.purpose,
      productId,
      priceId,
      quantity,
      currencyCode: "EUR",
      amountCents: unitCents * quantity,
      createdAt: now,
      expiresAt: now + PADDLE_CHECKOUT_INTENT_TTL_MS,
      consumedAt: null,
      providerReference: null,
    });
    await this.track?.execute({
      type: ACTIVITY_EVENTS.billingCheckoutStarted,
      userId: input.actor.id,
      workspaceId: input.workspaceId,
      source: "server",
      properties: { kind: input.purpose },
    });
    return {
      priceId,
      quantity,
      amountCents: unitCents * quantity,
      currencyCode: "EUR",
      customData: {
        checkout_intent_id: id,
        checkout_intent_sig: await hmacSign(
          this.paddle.webhookSecret,
          signaturePayload(id),
        ),
      },
    };
  }
}
