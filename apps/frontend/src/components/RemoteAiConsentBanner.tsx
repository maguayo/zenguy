import { Link } from "react-router-dom";

import type { RemoteAiConsentStatus } from "../api/types";
import { useWorkspace } from "../contexts/WorkspaceContext";
import {
  remoteAiConsentSettingsPath,
  useRemoteAiConsent,
} from "../hooks/useRemoteAiConsent";

export function shouldShowRemoteAiConsentBanner(input: {
  canManage: boolean;
  status: RemoteAiConsentStatus | undefined;
}): boolean {
  return input.canManage && input.status !== undefined && !input.status.active;
}

export function RemoteAiConsentBannerView({ wsId }: { wsId: string }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn-600/30 bg-warn-50 px-4 py-3 text-sm text-zinc-800"
      role="status"
    >
      <p className="min-w-0 flex-1">
        <span className="font-medium text-zinc-900">Browser tests won&apos;t run yet.</span>{" "}
        This workspace hasn&apos;t authorized OpenAI processing on Cloudflare Containers,
        so scheduled and manual runs end in a system error until an Owner or Admin
        enables AI data sharing.
      </p>
      <Link
        className="inline-flex h-8 shrink-0 items-center rounded-md border border-warn-600/30 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-warn-50"
        to={remoteAiConsentSettingsPath(wsId)}
      >
        Enable in Settings
      </Link>
    </div>
  );
}

/** Shown on browser-test pages to the roles that can grant consent. */
export function RemoteAiConsentBanner() {
  const { can, current } = useWorkspace();
  const consent = useRemoteAiConsent();
  if (
    !shouldShowRemoteAiConsentBanner({
      canManage: can("workspace.settings"),
      status: consent.data,
    })
  ) {
    return null;
  }
  return <RemoteAiConsentBannerView wsId={current.id} />;
}
