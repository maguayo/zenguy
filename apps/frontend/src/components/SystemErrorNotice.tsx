import { Link } from "react-router-dom";

import { remoteAiConsentSettingsPath } from "../hooks/useRemoteAiConsent";

/** `systemErrorCode` the API sets when a workspace has not consented to OpenAI. */
export const REMOTE_AI_CONSENT_REQUIRED_CODE = "REMOTE_AI_CONSENT_REQUIRED";

export function SystemErrorNotice({ code, wsId }: { code: string; wsId: string }) {
  if (code === REMOTE_AI_CONSENT_REQUIRED_CODE) {
    return (
      <div
        className="mt-3 rounded-md border border-warn-600/30 bg-warn-50 px-3 py-2 text-sm text-zinc-800"
        role="status"
      >
        <span className="font-medium text-zinc-900">
          OpenAI processing isn&apos;t authorized for this workspace,
        </span>{" "}
        so the run could not start. An Owner or Admin can enable AI data sharing in{" "}
        <Link
          className="font-medium text-accent-700 hover:underline"
          to={remoteAiConsentSettingsPath(wsId)}
        >
          Workspace Settings
        </Link>
        .
      </div>
    );
  }
  return <p className="mt-3 font-mono text-xs text-zinc-600">System error code: {code}</p>;
}
