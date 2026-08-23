import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { TrackEvent } from "../activity/track_event";
import type {
  IssuePaddleCheckoutIntent,
  PaddleCheckout,
} from "../billing/paddle_checkout_intent";

export const ALERT_CREDIT_PURPOSE = "alert_credit";

export type CreditTopUpCheckout = PaddleCheckout;

/**
 * Validates a top-up request and returns what the browser needs to open the
 * Paddle checkout. Credit is only added when the signed
 * `transaction.completed` webhook arrives.
 */
export class StartCreditTopUp {
  constructor(
    private readonly intents: IssuePaddleCheckoutIntent,
    private readonly track?: Pick<TrackEvent, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    packs: number;
  }): Promise<CreditTopUpCheckout> {
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
