import { apiGet, apiPost } from "../lib/api";
import type { Workspace } from "./types";

export interface PublicSubscriptionGrant {
  expiresAt: string;
  status: "valid";
}

export interface IssuedSubscriptionGrant {
  createdAt: string;
  expiresAt: string;
  id: string;
  note: string | null;
  redeemUrl: string;
  token: string;
}

export interface ListedSubscriptionGrant {
  createdAt: string;
  expiresAt: string;
  id: string;
  note: string | null;
  redeemedAt: string | null;
  redeemedWorkspaceId: string | null;
}

export function getSubscriptionGrant(token: string): Promise<PublicSubscriptionGrant> {
  return apiGet(`/api/subscription-grants/${encodeURIComponent(token)}`);
}

export function listSubscriptionGrants(): Promise<ListedSubscriptionGrant[]> {
  return apiGet("/api/subscription-grants");
}

export function issueSubscriptionGrant(note?: string): Promise<IssuedSubscriptionGrant> {
  return apiPost("/api/subscription-grants", note === undefined ? {} : { note });
}

export function redeemSubscriptionGrant(
  token: string,
  workspaceId: string,
): Promise<{ subscriptionStatus: "ACTIVE"; workspaceId: string }> {
  return apiPost(`/api/subscription-grants/${encodeURIComponent(token)}/redeem`, {
    workspaceId,
  });
}

export function complimentaryWorkspaces(workspaces: Workspace[]): Workspace[] {
  return workspaces.filter(
    (workspace) =>
      workspace.subscriptionStatus === "NONE" || workspace.subscriptionStatus === "CANCELED",
  );
}
