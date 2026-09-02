import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  grantRemoteAiConsent,
  remoteAiConsentQueryKey,
  revokeRemoteAiConsent,
} from "../../api/remote_ai_consent";
import type { RemoteAiConsentStatus } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Checkbox } from "../../components/ui/Checkbox";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { ErrorState } from "../../components/ui/ErrorState";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import {
  REMOTE_AI_CONSENT_CARD_ID,
  useRemoteAiConsent,
} from "../../hooks/useRemoteAiConsent";
import { apiErrorMessage } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";

export const REMOTE_AI_DATA_CATEGORIES = [
  "Test name, instructions, target URLs, and device configuration",
  "Relevant page content, screenshots, console output, and network results",
  "Model output used to perform steps and determine the test result",
] as const;

export function consentStatusLabel(
  status: Pick<RemoteAiConsentStatus, "active"> | undefined,
): "Enabled" | "Off" {
  return status?.active ? "Enabled" : "Off";
}

export interface RemoteAiConsentCardViewProps {
  affirmed: boolean;
  busy: boolean;
  error: boolean;
  loading: boolean;
  onAffirmedChange: (affirmed: boolean) => void;
  onEnable: () => void;
  onRetry: () => void;
  onRevoke: () => void;
  status: RemoteAiConsentStatus | undefined;
  timezone: string;
}

export function RemoteAiConsentCardView({
  affirmed,
  busy,
  error,
  loading,
  onAffirmedChange,
  onEnable,
  onRetry,
  onRevoke,
  status,
  timezone,
}: RemoteAiConsentCardViewProps) {
  return (
    <Card
      id={REMOTE_AI_CONSENT_CARD_ID}
      title={
        <span className="flex items-center gap-2">
          AI data sharing
          <Badge tone={status?.active ? "ok" : "neutral"}>{consentStatusLabel(status)}</Badge>
        </span>
      }
    >
      <div className="max-w-2xl space-y-4 text-sm text-zinc-600">
        <p>
          Zenguy runs browser tests on Cloudflare Containers with OpenAI&apos;s model. Nothing is
          sent to OpenAI, and no browser test runs in this workspace, until an Owner or Admin
          gives consent here.
        </p>
        <div>
          <p className="font-medium text-zinc-900">
            What is shared with OpenAI while consent is active
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {REMOTE_AI_DATA_CATEGORIES.map((category) => (
              <li key={category}>{category}</li>
            ))}
          </ul>
        </div>
        <p>
          Account, member, billing, and notification data are not sent for this purpose.
          Configured secret values stay in Zenguy and are never disclosed to OpenAI; runs receive
          only the placeholder names used by a test. Consent applies to this workspace only and
          can be revoked at any time.
        </p>
        <p>
          <Link className="font-medium text-accent-700 hover:underline" to="/privacy">
            Read the privacy policy
          </Link>
        </p>

        {loading ? (
          <Spinner label="Loading consent" />
        ) : error ? (
          <ErrorState onRetry={onRetry} />
        ) : status?.active ? (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-zinc-900">OpenAI processing is currently allowed.</p>
            {status.acceptedAt ? (
              <p className="mt-1 text-xs text-zinc-500">
                Accepted {formatDateTime(status.acceptedAt, timezone)} · policy{" "}
                {status.policyVersion}
              </p>
            ) : null}
            <Button className="mt-3" loading={busy} variant="danger" onClick={onRevoke}>
              Revoke consent…
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <label className="flex items-start gap-2" htmlFor="remote-ai-consent-affirm">
              <Checkbox
                checked={affirmed}
                className="mt-0.5"
                id="remote-ai-consent-affirm"
                onChange={(event) => onAffirmedChange(event.target.checked)}
              />
              <span className="text-zinc-900">
                I understand and consent to the OpenAI data sharing described above
              </span>
            </label>
            <p className="mt-1 pl-6 text-xs text-zinc-500">
              This box starts unchecked and is never enabled automatically.
            </p>
            <Button
              className="mt-3"
              disabled={!affirmed}
              loading={busy}
              variant="primary"
              onClick={onEnable}
            >
              Enable OpenAI processing
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Owner/Admin card on the workspace settings page. Members see nothing. */
export function RemoteAiConsentCard() {
  const { can, current, timezone } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const consent = useRemoteAiConsent();
  const [affirmed, setAffirmed] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const grant = useMutation({ mutationFn: () => grantRemoteAiConsent(current.id) });
  const revoke = useMutation({ mutationFn: () => revokeRemoteAiConsent(current.id) });

  if (!can("workspace.settings")) return null;

  const queryKey = remoteAiConsentQueryKey(current.id);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ["ws", current.id, "audit"] }),
    ]);

  const enable = async () => {
    if (!affirmed) return;
    try {
      const next = await grant.mutateAsync();
      queryClient.setQueryData(queryKey, next);
      setAffirmed(false);
      await refresh();
      toast.success("OpenAI processing enabled");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const confirmRevoke = async () => {
    try {
      await revoke.mutateAsync();
      await refresh();
      toast.success("OpenAI consent revoked");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  return (
    <>
      <RemoteAiConsentCardView
        affirmed={affirmed}
        busy={grant.isPending || revoke.isPending}
        error={consent.isError}
        loading={consent.isPending}
        status={consent.data}
        timezone={timezone}
        onAffirmedChange={setAffirmed}
        onEnable={() => void enable()}
        onRetry={() => void consent.refetch()}
        onRevoke={() => setRevokeOpen(true)}
      />
      <ConfirmDialog
        body="Browser tests in this workspace will stop running until consent is granted again. A run that already started may finish."
        confirmLabel="Revoke consent"
        onClose={() => setRevokeOpen(false)}
        onConfirm={confirmRevoke}
        open={revokeOpen}
        title="Revoke OpenAI consent?"
        tone="danger"
      />
    </>
  );
}
