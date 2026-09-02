import { useQuery } from "@tanstack/react-query";

import { getRemoteAiConsent, remoteAiConsentQueryKey } from "../api/remote_ai_consent";
import { useWorkspace } from "../contexts/WorkspaceContext";

/** Anchor of the consent card on the workspace settings page. */
export const REMOTE_AI_CONSENT_CARD_ID = "ai-data-sharing";

export function remoteAiConsentSettingsPath(workspaceId: string): string {
  return `/w/${workspaceId}/settings#${REMOTE_AI_CONSENT_CARD_ID}`;
}

/**
 * Consent status of the current workspace. The API only answers Owners and
 * Admins, and those are also the only roles able to create or run browser
 * tests, so the query stays disabled for members instead of failing with 403.
 */
export function useRemoteAiConsent() {
  const { can, current } = useWorkspace();
  return useQuery({
    enabled: can("workspace.settings"),
    queryFn: () => getRemoteAiConsent(current.id),
    queryKey: remoteAiConsentQueryKey(current.id),
  });
}
