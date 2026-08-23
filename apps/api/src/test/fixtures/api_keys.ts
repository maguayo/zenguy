import type { Subscription } from "../../domain/billing/types";
import {
  DEFAULT_API_KEY_SCOPES,
  type WorkspaceApiKey,
} from "../../domain/api_keys/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";

export const OWNER: User = {
  id: "usr_api_keys_owner",
  name: "Owner",
  email: "owner@apikeys.test",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};

export const WORKSPACE: Workspace = {
  id: "ws_api_keys",
  name: "API Keys Workspace",
  slug: "api-keys-workspace",
  timezone: "UTC",
  ownerUserId: OWNER.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

export function activeSubscription(): Subscription {
  return {
    id: "sub_api_keys",
    workspaceId: WORKSPACE.id,
    provider: "paddle",
    providerCustomerId: "ctm_api_keys",
    providerSubscriptionId: "sub_provider_api_keys",
    status: "ACTIVE",
    periodStart: 1,
    periodEnd: 9_999_999_999_999,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

export function storedApiKey(
  overrides: Partial<WorkspaceApiKey> = {},
): WorkspaceApiKey {
  return {
    id: "ak_stored_1",
    workspaceId: WORKSPACE.id,
    name: "Dashboard",
    keyPrefix: "zgk_stored00",
    keyHash: "stored-hash-1",
    scopes: [...DEFAULT_API_KEY_SCOPES],
    expiresAt: 9_999_999_999_999,
    createdBy: OWNER.id,
    createdAt: 100,
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}
