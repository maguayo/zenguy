import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { TrackEvent } from "../activity/track_event";
import type { CheckoutPurpose } from "../../domain/billing/types";

export const ALERT_CREDIT_PURPOSE = "alert_credit";

interface CheckoutIssuer<TCheckout extends { amountCents: number }> {
  execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    purpose: CheckoutPurpose;
    quantity?: number;
  }): Promise<TCheckout>;
}

/**
 * Validates a top-up request and returns what the browser needs to open the
 * hosted checkout. Credit is only added when a signed provider webhook
 * confirms that payment completed.
 */
export class StartCreditTopUp<TCheckout extends { amountCents: number }> {
  constructor(
    private readonly intents: CheckoutIssuer<TCheckout>,
    private readonly track?: Pick<TrackEvent, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    packs: number;
  }): Promise<TCheckout> {
    const checkout = await this.intents.execute({
      workspaceId: input.workspaceId,
      actor: input.actor,
      actorRole: input.actorRole,
      purpose: ALERT_CREDIT_PURPOSE,
      quantity: input.packs,
    });
    await this.track?.execute({
      type: ACTIVITY_EVENTS.alertsTopupStarted,
      userId: input.actor.id,
      workspaceId: input.workspaceId,
      source: "server",
      properties: { amountCents: checkout.amountCents },
    });
    return checkout;
  }
}
