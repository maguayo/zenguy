import type { ListedSubscriptionGrant, PublicSubscriptionGrant } from "@/api/grants";
import type { User } from "@/api/types";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export type GrantLinkState = "error" | "expired" | "loading" | "unavailable" | "valid";

/**
 * The API answers 410 GONE for links that are unknown, already used or
 * expired; a still-valid link that expired since it was loaded is caught here.
 */
export function grantLinkState({
  error,
  grant,
  now = Date.now(),
  pending,
  token,
}: {
  error: unknown;
  grant: PublicSubscriptionGrant | undefined;
  now?: number;
  pending: boolean;
  token: string | null;
}): GrantLinkState {
  if (!token) return "unavailable";
  if (error instanceof ApiError && error.code === "GONE") return "unavailable";
  if (error) return "error";
  if (pending || !grant) return "loading";
  const expiresAt = new Date(grant.expiresAt).getTime();
  if (!Number.isNaN(expiresAt) && expiresAt <= now) return "expired";
  return "valid";
}

export const unavailableGrantMessage =
  "This complimentary link is invalid or has already been used.";

export const expiredGrantMessage = "This complimentary link has expired.";

export const redeemDescription = "Activate a workspace without adding a payment method.";

export const newWorkspaceHint = "None of your workspaces are unpaid, so we will create a new one.";

export const issueDescription =
  "Create a one-time link that activates a workspace without Stripe checkout.";

export function defaultGrantWorkspaceName(user: Pick<User, "name"> | null): string {
  if (!user) return "My Workspace";
  return `${user.name.trim().split(/\s+/u)[0] || "My"}'s Workspace`;
}

export function issuedGrantSummary(grant: ListedSubscriptionGrant): string {
  return grant.redeemedAt
    ? `Used ${formatDateTime(grant.redeemedAt, "UTC")}`
    : `Expires ${formatDateTime(grant.expiresAt, "UTC")}`;
}
