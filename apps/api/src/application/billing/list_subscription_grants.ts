import type { SubscriptionGrantRepo } from "../../domain/billing/repo";
import type { SubscriptionGrant } from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import {
  isComplimentaryIssuer,
  type AppConfig,
} from "../../shared/config";
import { forbidden } from "../../shared/errors";

export interface ListedSubscriptionGrant {
  id: string;
  note: string | null;
  expiresAt: number;
  redeemedAt: number | null;
  redeemedWorkspaceId: string | null;
  createdAt: number;
}

export class ListSubscriptionGrants {
  constructor(
    private readonly grants: SubscriptionGrantRepo,
    private readonly config: Pick<AppConfig, "complimentaryIssuerEmails">,
  ) {}

  async execute(input: { actor: User }): Promise<ListedSubscriptionGrant[]> {
    if (
      !isComplimentaryIssuer(
        this.config.complimentaryIssuerEmails,
        input.actor.email,
      )
    ) {
      throw forbidden("You cannot issue complimentary subscription links");
    }
    return (await this.grants.listByIssuer(input.actor.id)).map(toListed);
  }
}

function toListed(grant: SubscriptionGrant): ListedSubscriptionGrant {
  return {
    id: grant.id,
    note: grant.note,
    expiresAt: grant.expiresAt,
    redeemedAt: grant.redeemedAt,
    redeemedWorkspaceId: grant.redeemedWorkspaceId,
    createdAt: grant.createdAt,
  };
}
