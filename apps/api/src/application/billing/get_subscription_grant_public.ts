import type { SubscriptionGrantRepo } from "../../domain/billing/repo";
import type { Clock } from "../../shared/clock";
import { sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";

function gone(): AppError {
  return new AppError(
    "GONE",
    "This complimentary link is invalid or has already been used",
  );
}

export interface PublicSubscriptionGrant {
  expiresAt: number;
  status: "valid";
}

export class GetSubscriptionGrantPublic {
  constructor(
    private readonly grants: SubscriptionGrantRepo,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    tokenPlain: string;
  }): Promise<PublicSubscriptionGrant> {
    const tokenHash = await sha256Hex(input.tokenPlain);
    const grant = await this.grants.findValidByHash(
      tokenHash,
      this.clock.now(),
    );
    if (grant === null) throw gone();
    return { expiresAt: grant.expiresAt, status: "valid" };
  }
}
