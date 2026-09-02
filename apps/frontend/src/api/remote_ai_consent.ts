import { apiDelete, apiGet, apiPut } from "../lib/api";
import type { RemoteAiConsentStatus } from "./types";

/** Policy version this consent screen describes. Must match the API constant. */
export const REMOTE_AI_CONSENT_VERSION = "2026-09-01-v1";

export function remoteAiConsentPath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/remote-ai-consent`;
}

export function remoteAiConsentQueryKey(workspaceId: string) {
  return ["ws", workspaceId, "remote-ai-consent"] as const;
}

export function getRemoteAiConsent(workspaceId: string): Promise<RemoteAiConsentStatus> {
  return apiGet(remoteAiConsentPath(workspaceId));
}

export function grantRemoteAiConsent(workspaceId: string): Promise<RemoteAiConsentStatus> {
  return apiPut(remoteAiConsentPath(workspaceId), {
    consent: true,
    policyVersion: REMOTE_AI_CONSENT_VERSION,
  });
}

export function revokeRemoteAiConsent(workspaceId: string): Promise<void> {
  return apiDelete(remoteAiConsentPath(workspaceId));
}
