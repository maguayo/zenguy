import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ExternalLink,
  Globe,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import clsx from "clsx";

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
import { Spinner } from "../../components/ui/Spinner";
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

export type WizardStep = "connect" | "dns" | "verify" | "done" | "failed";

/**
 * Where the customer is in the flow. The check result refines the two
 * waiting phases: pointing DNS (step 2) versus certificate issuance (step 3).
 */
export function wizardStep(
  domain: StatusPageCustomDomain | null,
  check: CustomDomainCheck | null,
): WizardStep {
  if (domain === null) return "connect";
  if (domain.status === "ACTIVE") return "done";
  if (domain.status === "FAILED") return "failed";
  if (check !== null && check.cname.correct) return "verify";
  return "dns";
}

const STEP_ORDER = ["connect", "dns", "verify"] as const;
const STEP_TITLES: Record<(typeof STEP_ORDER)[number], string> = {
  connect: "Choose domain",
  dns: "Add DNS record",
  verify: "Verification",
};

export function WizardStepper({ step }: { step: WizardStep }) {
  const activeIndex =
    step === "done" || step === "failed"
      ? STEP_ORDER.length
      : STEP_ORDER.indexOf(step);
  return (
    <ol aria-label="Custom domain setup progress" className="flex items-center gap-2">
      {STEP_ORDER.map((name, index) => {
        const state =
          index < activeIndex ? "done" : index === activeIndex ? "current" : "next";
        return (
          <li key={name} className="flex items-center gap-2">
            {index > 0 ? <span className="h-px w-6 bg-zinc-300" /> : null}
            <span
              className={clsx(
                "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                state === "done" && "bg-ok-600 text-white",
                state === "current" && "bg-accent-600 text-white",
                state === "next" && "border border-zinc-300 text-zinc-500",
              )}
            >
              {state === "done" ? (
                <Check aria-hidden="true" className="size-3" />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={clsx(
                "text-xs font-medium",
                state === "current" ? "text-zinc-900" : "text-zinc-500",
              )}
            >
              {STEP_TITLES[name]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function DnsInstructions({
  hostname,
  target,
}: {
  hostname: string;
  target: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <p className="text-sm font-medium text-zinc-900">
        Create this record at your DNS provider
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">
        Cloudflare, GoDaddy, Namecheap, Route 53… it is the same everywhere.
        Some providers only want the subdomain part (e.g.{" "}
        <span className="font-mono">{hostname.split(".")[0]}</span>) in the Name
        field.
      </p>
      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 font-mono text-xs text-zinc-800">
        <span className="text-zinc-500">Type</span>
        <span>CNAME</span>
        <span />
        <span className="text-zinc-500">Name</span>
        <span className="truncate" title={hostname}>
          {hostname}
        </span>
        <CopyButton label="Copy record name" text={hostname} />
        <span className="text-zinc-500">Target</span>
        <span className="truncate" title={target}>
          {target}
        </span>
        <CopyButton label="Copy record target" text={target} />
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        DNS changes usually apply within minutes, but can take up to an hour.
        We keep checking automatically.
      </p>
    </div>
  );
}

export function CheckDiagnostics({ check }: { check: CustomDomainCheck }) {
  return (
    <ul className="space-y-1.5 text-xs">
      <li
        className={clsx(
          "flex items-start gap-1.5",
          check.cname.correct ? "text-ok-700" : "text-zinc-600",
        )}
      >
        {check.cname.correct ? (
          <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <span className="mt-0.5 size-3.5 shrink-0 rounded-full border border-zinc-400" />
        )}
        {check.cname.correct
          ? `DNS is correct — ${check.domain} points to ${check.cnameTarget}.`
          : check.cname.found
            ? `Your CNAME points to ${check.cname.value ?? "?"} instead of ${check.cnameTarget}.`
            : "No CNAME record found yet."}
      </li>
      <li
        className={clsx(
          "flex items-start gap-1.5",
          check.sslStatus === "active" ? "text-ok-700" : "text-zinc-600",
        )}
      >
        {check.sslStatus === "active" ? (
          <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <span className="mt-0.5 size-3.5 shrink-0 rounded-full border border-zinc-400" />
        )}
        {check.sslStatus === "active"
          ? "TLS certificate issued."
          : `TLS certificate: ${check.sslStatus ?? "waiting for DNS"}.`}
      </li>
      {check.errors.map((error) => (
        <li key={error} className="flex items-start gap-1.5 text-danger-600">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </li>
      ))}
    </ul>
  );
}

function WizardShell({
  actions,
  children,
  step,
}: {
  actions?: ReactNode;
  children: ReactNode;
  step: WizardStep;
}) {
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Globe aria-hidden="true" className="size-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900">Custom domain</h2>
        </div>
        {actions}
      </div>
      <WizardStepper step={step} />
      {children}
    </Card>
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
    queryFn: async () => {
      const result = await checkCustomDomain(workspaceId, pageId);
      if (domain !== null && result.status !== domain.status) {
        await onChanged();
      }
      return result;
    },
    queryKey: checkKey,
    // Keep watching while the customer fights DNS/certificates elsewhere.
    refetchInterval: (query) =>
      query.state.data?.status === "PENDING" ? 30_000 : false,
    retry: false,
  });

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
      toast.success("Domain connected — one DNS record to go");
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

  if (!manage) {
    return (
      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Globe aria-hidden="true" className="size-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900">Custom domain</h2>
        </div>
        {domain === null ? (
          <p className="text-sm text-zinc-500">No custom domain connected.</p>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-zinc-900">
              {domain.hostname}
            </span>
            <Badge tone={customDomainStatusTone(domain.status)}>
              {customDomainStatusLabel(domain.status)}
            </Badge>
          </div>
        )}
      </Card>
    );
  }

  const step = wizardStep(domain, check.data ?? null);
  const checkUnavailable =
    check.isError &&
    check.error instanceof ApiError &&
    check.error.code === "SERVICE_UNAVAILABLE";

  const manageActions =
    domain !== null ? (
      <div className="flex items-center gap-2">
        <Button
          disabled={check.isFetching}
          onClick={() => void check.refetch()}
          variant="secondary"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Check now
        </Button>
        <Button onClick={() => setRemoveOpen(true)} variant="ghost">
          Remove
        </Button>
      </div>
    ) : undefined;

  return (
    <WizardShell actions={manageActions} step={step}>
      {step === "connect" ? (
        <form className="space-y-3" onSubmit={submit}>
          <p className="text-sm text-zinc-600">
            Serve this status page on a domain your customers already trust,
            like <span className="font-mono">status.yourcompany.com</span>.
          </p>
          <Field
            error={fieldError ?? undefined}
            hint="Use a subdomain. Apex domains (yourcompany.com) only work if your DNS provider supports CNAME flattening."
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
              placeholder="status.yourcompany.com"
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
      ) : null}

      {domain !== null && (step === "dns" || step === "verify") ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-zinc-900">
              {domain.hostname}
            </span>
            <Badge tone="warn">Pending</Badge>
            {check.isFetching ? <Spinner label="Checking" size={4} /> : null}
          </div>
          {step === "dns" && check.data !== undefined ? (
            <DnsInstructions
              hostname={domain.hostname}
              target={check.data.cnameTarget}
            />
          ) : null}
          {step === "verify" ? (
            <p className="text-sm text-zinc-600">
              DNS looks good. Cloudflare is now issuing the TLS certificate for{" "}
              <span className="font-mono">{domain.hostname}</span> — this
              usually takes a few minutes and finishes on its own.
            </p>
          ) : null}
          {check.data !== undefined ? <CheckDiagnostics check={check.data} /> : null}
          {checkUnavailable ? (
            <p className="text-xs text-warn-700">
              Custom domains are not fully configured on the server yet — your
              domain is saved and verification will resume once they are.
            </p>
          ) : check.isError ? (
            <p className="text-xs text-danger-600">
              {apiErrorMessage(check.error)}
            </p>
          ) : null}
        </div>
      ) : null}

      {domain !== null && step === "done" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-zinc-900">
              {domain.hostname}
            </span>
            <Badge tone="ok">Active</Badge>
          </div>
          <p className="text-sm text-zinc-600">
            Your status page is live on your own domain. The zenguy.com URL
            keeps working too.
          </p>
          <a
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-700 hover:underline"
            href={`https://${domain.hostname}/`}
            rel="noreferrer"
            target="_blank"
          >
            Open https://{domain.hostname}/
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      ) : null}

      {domain !== null && step === "failed" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-zinc-900">
              {domain.hostname}
            </span>
            <Badge tone="danger">Failed</Badge>
          </div>
          <p className="text-sm text-zinc-600">
            Verification failed. Remove the domain and connect it again — and
            make sure the CNAME record below still exists at your provider.
          </p>
          {check.data !== undefined ? <CheckDiagnostics check={check.data} /> : null}
          <div>
            <Button onClick={() => setRemoveOpen(true)} variant="danger">
              Remove and start over
            </Button>
          </div>
        </div>
      ) : null}

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
    </WizardShell>
  );
}
