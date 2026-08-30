import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, RefreshCw } from "lucide-react";

import {
  checkCustomDomain,
  removeCustomDomain,
  setCustomDomain,
} from "../../api/status_pages";
import type {
  CustomDomainCheck,
  CustomDomainStatus,
  StatusPageCustomDomain,
} from "../../api/types";
import { CopyButton } from "../../components/CopyButton";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { useToast } from "../../contexts/ToastContext";
import { useMutationError } from "../../hooks/useMutationError";
import { ApiError } from "../../lib/api";
import { apiErrorMessage, apiFieldErrors } from "../../lib/errors";

export function customDomainStatusLabel(status: CustomDomainStatus): string {
  if (status === "ACTIVE") return "Active";
  if (status === "FAILED") return "Failed";
  return "Pending";
}

export function customDomainStatusTone(
  status: CustomDomainStatus,
): "ok" | "warn" | "danger" {
  if (status === "ACTIVE") return "ok";
  if (status === "FAILED") return "danger";
  return "warn";
}

export function CustomDomainDetails({
  check,
  domain,
}: {
  check: CustomDomainCheck | null;
  domain: StatusPageCustomDomain;
}) {
  const target = check?.cnameTarget ?? null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-zinc-900">{domain.hostname}</span>
        <Badge tone={customDomainStatusTone(domain.status)}>
          {customDomainStatusLabel(domain.status)}
        </Badge>
        {domain.status === "ACTIVE" ? (
          <a
            className="text-xs font-medium text-accent-700 hover:underline"
            href={`https://${domain.hostname}/`}
            rel="noreferrer"
            target="_blank"
          >
            Open
          </a>
        ) : null}
      </div>

      {domain.status !== "ACTIVE" && target !== null ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-medium text-zinc-700">
            Create this DNS record at your provider:
          </p>
          <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 font-mono text-xs text-zinc-800">
            <span className="text-zinc-500">Type</span>
            <span>CNAME</span>
            <span />
            <span className="text-zinc-500">Name</span>
            <span className="truncate">{domain.hostname}</span>
            <CopyButton label="Copy record name" text={domain.hostname} />
            <span className="text-zinc-500">Target</span>
            <span className="truncate">{target}</span>
            <CopyButton label="Copy record target" text={target} />
          </div>
        </div>
      ) : null}

      {check !== null ? (
        <ul className="space-y-1 text-xs">
          <li className={check.cname.correct ? "text-ok-700" : "text-zinc-600"}>
            {check.cname.correct
              ? `DNS looks good — ${check.domain} points to ${check.cnameTarget}.`
              : check.cname.found
                ? `Your CNAME points to ${check.cname.value ?? "?"} instead of ${check.cnameTarget}.`
                : "No CNAME record found yet (DNS changes can take a few minutes)."}
          </li>
          <li
            className={
              check.sslStatus === "active" ? "text-ok-700" : "text-zinc-600"
            }
          >
            {check.sslStatus === "active"
              ? "Certificate issued."
              : `Certificate: ${check.sslStatus ?? "waiting for DNS"}.`}
          </li>
          {check.errors.map((error) => (
            <li key={error} className="text-danger-600">
              {error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CustomDomainCard({
  domain,
  manage,
  onChanged,
  pageId,
  workspaceId,
}: {
  domain: StatusPageCustomDomain | null;
  manage: boolean;
  onChanged: () => Promise<void>;
  pageId: string;
  workspaceId: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const [hostname, setHostname] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const checkKey = [
    "ws",
    workspaceId,
    "status-pages",
    pageId,
    "custom-domain-check",
  ];
  const check = useQuery({
    enabled: manage && domain !== null,
    queryFn: () => checkCustomDomain(workspaceId, pageId),
    queryKey: checkKey,
    retry: false,
  });
  useEffect(() => {
    if (
      domain !== null &&
      check.data !== undefined &&
      check.data.status !== domain.status
    ) {
      void onChanged();
    }
  }, [check.data, domain, onChanged]);

  const connect = useMutation({
    mutationFn: () => setCustomDomain(workspaceId, pageId, hostname.trim()),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    try {
      await connect.mutateAsync();
      setHostname("");
      await onChanged();
      await queryClient.invalidateQueries({ queryKey: checkKey });
      toast.success("Domain connected — now create the CNAME record");
    } catch (error) {
      if (handleMutationError(error)) return;
      const fields = apiFieldErrors(error);
      const message =
        fields.hostname ??
        (error instanceof ApiError &&
        (error.code === "CONFLICT" || error.code === "SERVICE_UNAVAILABLE")
          ? error.message
          : null);
      if (message !== null) {
        setFieldError(message);
        return;
      }
      toast.error(apiErrorMessage(error));
    }
  };

  const remove = async () => {
    try {
      await removeCustomDomain(workspaceId, pageId);
      queryClient.removeQueries({ queryKey: checkKey });
      await onChanged();
      toast.success("Custom domain removed");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Globe aria-hidden="true" className="size-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900">Custom domain</h2>
        </div>
        {manage && domain !== null ? (
          <div className="flex items-center gap-2">
            <Button
              disabled={check.isFetching}
              onClick={() => void check.refetch()}
              variant="secondary"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Check DNS
            </Button>
            <Button onClick={() => setRemoveOpen(true)} variant="ghost">
              Remove
            </Button>
          </div>
        ) : null}
      </div>

      {domain === null ? (
        manage ? (
          <form className="space-y-3" onSubmit={submit}>
            <Field
              error={fieldError ?? undefined}
              hint="Serve this status page on your own subdomain, e.g. status.example.com."
              htmlFor="custom-domain-hostname"
              label="Hostname"
            >
              <Input
                id="custom-domain-hostname"
                invalid={fieldError !== null}
                onChange={(event) => {
                  setHostname(event.target.value);
                  setFieldError(null);
                }}
                placeholder="status.example.com"
                required
                value={hostname}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                disabled={connect.isPending || hostname.trim() === ""}
                type="submit"
                variant="primary"
              >
                Connect domain
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-zinc-500">No custom domain connected.</p>
        )
      ) : (
        <>
          <CustomDomainDetails
            check={manage ? (check.data ?? null) : null}
            domain={domain}
          />
          {manage && check.isError ? (
            <p className="text-xs text-danger-600">
              {apiErrorMessage(check.error)}
            </p>
          ) : null}
        </>
      )}

      <ConfirmDialog
        body="The domain stops serving this page immediately. The zenguy.com URL keeps working."
        confirmLabel="Remove domain"
        onClose={() => setRemoveOpen(false)}
        onConfirm={() => {
          setRemoveOpen(false);
          void remove();
        }}
        open={removeOpen}
        title={`Disconnect "${domain?.hostname ?? ""}"?`}
        tone="danger"
      />
    </Card>
  );
}
