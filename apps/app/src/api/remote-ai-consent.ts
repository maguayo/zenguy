import { apiDelete, apiGet, apiPut } from "../lib/api";

export const REMOTE_AI_CONSENT_VERSION = "2026-09-01-v1";

export interface RemoteAiConsentStatus {
  active: boolean;
  provider: "OpenAI";
  policyVersion: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

function path(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/remote-ai-consent`;
}

export function getRemoteAiConsent(workspaceId: string): Promise<RemoteAiConsentStatus> {
  return apiGet(path(workspaceId));
}

export function grantRemoteAiConsent(workspaceId: string): Promise<RemoteAiConsentStatus> {
  return apiPut(path(workspaceId), {
    consent: true,
    policyVersion: REMOTE_AI_CONSENT_VERSION,
  });
}

export function revokeRemoteAiConsent(workspaceId: string): Promise<void> {
  return apiDelete(path(workspaceId));
}
