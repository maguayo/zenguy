export const REMOTE_AI_PROVIDER = "openai" as const;
export const REMOTE_AI_CONSENT_VERSION = "2026-09-01-v1" as const;

export interface RemoteAiConsent {
  workspaceId: string;
  provider: typeof REMOTE_AI_PROVIDER;
  policyVersion: string;
  acceptedByUserId: string | null;
  acceptedAt: number;
  revokedByUserId: string | null;
  revokedAt: number | null;
  updatedAt: number;
}

export interface RemoteAiConsentRepo {
  find(workspaceId: string): Promise<RemoteAiConsent | null>;
  hasActive(
    workspaceId: string,
    provider: typeof REMOTE_AI_PROVIDER,
    policyVersion: string,
  ): Promise<boolean>;
  grant(input: {
    workspaceId: string;
    provider: typeof REMOTE_AI_PROVIDER;
    policyVersion: string;
    actorUserId: string;
    at: number;
  }): Promise<void>;
  revoke(input: {
    workspaceId: string;
    actorUserId: string;
    at: number;
  }): Promise<boolean>;
}

/**
 * `systemErrorCode` of an attempt that a remote-only runner (Cloudflare
 * Containers) refused because the workspace has no active consent. Closing the
 * attempt at claim time keeps the run from rotting as a WORKER_LOST zombie.
 */
export const REMOTE_AI_CONSENT_REQUIRED_ERROR_CODE =
  "REMOTE_AI_CONSENT_REQUIRED" as const;
export const REMOTE_AI_CONSENT_REQUIRED_REASON =
  "The workspace has not authorized remote AI processing (OpenAI). " +
  "Grant AI data sharing consent for the workspace to run browser tests.";
