import type { IssuedSubscriptionGrant } from "../../application/billing/issue_subscription_grant";
import type { ListedSubscriptionGrant } from "../../application/billing/list_subscription_grants";
import type { PublicSubscriptionGrant } from "../../application/billing/get_subscription_grant_public";

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function presentIssuedGrant(grant: IssuedSubscriptionGrant) {
  return {
    id: grant.id,
    token: grant.token,
    redeemUrl: grant.redeemUrl,
    note: grant.note,
    expiresAt: iso(grant.expiresAt),
    createdAt: iso(grant.createdAt),
  };
}

export function presentListedGrant(grant: ListedSubscriptionGrant) {
  return {
    id: grant.id,
    note: grant.note,
    expiresAt: iso(grant.expiresAt),
    redeemedAt: grant.redeemedAt === null ? null : iso(grant.redeemedAt),
    redeemedWorkspaceId: grant.redeemedWorkspaceId,
    createdAt: iso(grant.createdAt),
  };
}

export function presentPublicGrant(grant: PublicSubscriptionGrant) {
  return {
    status: grant.status,
    expiresAt: iso(grant.expiresAt),
  };
}
