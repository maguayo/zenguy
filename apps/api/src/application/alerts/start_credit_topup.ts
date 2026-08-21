import {
  ALERT_CREDIT_MAX_PACKS,
  ALERT_CREDIT_MIN_PACKS,
  ALERT_CREDIT_PACK_CENTS,
} from "../../domain/alerts/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import { forbidden, unavailable, validation } from "../../shared/errors";

export const ALERT_CREDIT_PURPOSE = "alert_credit";

export interface CreditTopUpCheckout {
  priceId: string;
  quantity: number;
  amountCents: number;
  customData: { workspace_id: string; purpose: typeof ALERT_CREDIT_PURPOSE };
}

/**
 * Validates a top-up request and returns what the browser needs to open the
 * Paddle checkout. Credit is only added when the signed
 * `transaction.completed` webhook arrives.
 */
export class StartCreditTopUp {
  constructor(private readonly alertCreditPriceId: string | null) {}

  async execute(input: {
    workspaceId: string;
    actorRole: Role;
    packs: number;
  }): Promise<CreditTopUpCheckout> {
    if (!can(input.actorRole, "billing.manage")) throw forbidden();
    if (
      !Number.isInteger(input.packs) ||
      input.packs < ALERT_CREDIT_MIN_PACKS ||
      input.packs > ALERT_CREDIT_MAX_PACKS
    ) {
      throw validation([
        {
          field: "packs",
          message: `Must be an integer between ${ALERT_CREDIT_MIN_PACKS} and ${ALERT_CREDIT_MAX_PACKS}`,
        },
      ]);
    }
    if (this.alertCreditPriceId === null) {
      throw unavailable("Top-ups are not available yet");
    }
    return {
      priceId: this.alertCreditPriceId,
      quantity: input.packs,
      amountCents: input.packs * ALERT_CREDIT_PACK_CENTS,
      customData: {
        workspace_id: input.workspaceId,
        purpose: ALERT_CREDIT_PURPOSE,
      },
    };
  }
}
