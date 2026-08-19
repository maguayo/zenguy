import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { getBilling, getInvoiceUrl } from "../../api/billing";
import type { Billing, Invoice, SubscriptionStatus } from "../../api/types";
import { AccessDenied } from "../../components/AccessDenied";
import { UsageMeter } from "../../components/UsageMeter";
import { Badge, type BadgeProps } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { Table, type TableColumn } from "../../components/ui/Table";
import { Tooltip } from "../../components/ui/Tooltip";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { apiErrorMessage } from "../../lib/errors";
import { formatDateTime, formatEuros } from "../../lib/format";

export interface SubscriptionPresentation {
  label: string;
  tone: NonNullable<BadgeProps["tone"]>;
}

export function subscriptionPresentation(
  status: SubscriptionStatus,
): SubscriptionPresentation {
  switch (status) {
    case "ACTIVE":
      return { label: "Active", tone: "ok" };
    case "PAST_DUE":
      return { label: "Past due", tone: "warn" };
    case "CANCELED":
      return { label: "Canceled", tone: "danger" };
    case "NONE":
      return { label: "Not set up", tone: "neutral" };
  }
}

export function invoiceStatus(status: string): SubscriptionPresentation {
  const normalized = status.toUpperCase();
  if (normalized === "PAID" || normalized === "COMPLETED") {
    return { label: normalized === "PAID" ? "Paid" : "Completed", tone: "ok" };
  }
  if (normalized === "PAST_DUE" || normalized === "PENDING") {
    return { label: normalized === "PAST_DUE" ? "Past due" : "Pending", tone: "warn" };
  }
  if (normalized === "FAILED" || normalized === "CANCELED") {
    return { label: normalized === "FAILED" ? "Failed" : "Canceled", tone: "danger" };
  }
  return { label: status, tone: "neutral" };
}

export function invoiceColumns(
  timezone: string,
  renderAction?: (invoice: Invoice) => ReactNode,
): TableColumn<Invoice>[] {
  return [
    {
      header: "Date",
      key: "date",
      render: (invoice) =>
        invoice.billedAt ? (
          <span className="whitespace-nowrap">{formatDateTime(invoice.billedAt, timezone)}</span>
        ) : (
          "—"
        ),
    },
    { header: "Invoice #", key: "number", render: (invoice) => invoice.invoiceNumber ?? "—" },
    {
      header: "Total",
      key: "total",
      render: (invoice) => <span className="whitespace-nowrap font-medium">{formatEuros(invoice.totalCents)}</span>,
    },
    {
      header: "Status",
      key: "status",
      render: (invoice) => {
        const display = invoiceStatus(invoice.status);
        return <Badge tone={display.tone}>{display.label}</Badge>;
      },
    },
    {
      className: "text-right",
      header: <span className="sr-only">Actions</span>,
      key: "actions",
      render: (invoice) => renderAction?.(invoice) ?? null,
    },
  ];
}

function BillingSkeleton() {
  return (
    <div aria-label="Loading billing" className="grid gap-4 lg:grid-cols-2" role="status">
      {Array.from({ length: 2 }, (_, index) => (
        <Card key={index} className="min-h-64 space-y-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </Card>
      ))}
      <Card className="min-h-48 lg:col-span-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-5 h-24 w-full" />
      </Card>
    </div>
  );
}

function PlanCard({ billing }: { billing: Billing }) {
  const { current, timezone } = useWorkspace();
  const complimentary = billing.subscription.source === "grant";
  const status = complimentary
    ? { label: "Complimentary", tone: "ok" as const }
    : subscriptionPresentation(billing.subscription.status);
  const needsSetup =
    !complimentary &&
    (billing.subscription.status === "NONE" || billing.subscription.status === "CANCELED");

  return (
    <Card title="Plan">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold text-zinc-900">
          {complimentary ? "Zenguy — complimentary" : "Zenguy — 39 €/month"}
        </p>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="mt-3 text-sm text-zinc-600">
        {complimentary
          ? "300 runs included · extra runs are not billed · Unlimited members"
          : "300 runs included · 0,20 € per extra run · Unlimited members"}
      </p>
      {billing.subscription.cancelAtPeriodEnd && billing.subscription.periodEnd ? (
        <p className="mt-4 rounded-md border border-warn-600/25 bg-warn-50 p-3 text-sm text-warn-600">
          Your subscription ends on {formatDateTime(billing.subscription.periodEnd, timezone)}.
        </p>
      ) : null}
      {needsSetup ? (
        <Link
          className="mt-5 inline-flex h-9 items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
          to={`/w/${current.id}/setup/billing`}
        >
          Set up subscription
        </Link>
      ) : null}
    </Card>
  );
}

function UsageCard({ billing }: { billing: Billing }) {
  const { timezone } = useWorkspace();
  return (
    <Card title="Usage">
      <UsageMeter timezone={timezone} usage={billing.usage} />
      <p className="mt-4 text-xs text-zinc-500">
        Current period: {formatDateTime(billing.usage.periodStart, timezone)} –{" "}
        {formatDateTime(billing.usage.periodEnd, timezone)}
      </p>
    </Card>
  );
}

function InvoicesCard({ billing }: { billing: Billing }) {
  const { current, timezone } = useWorkspace();
  const toast = useToast();
  const [loadingId, setLoadingId] = useState<string>();

  const openInvoice = async (invoice: Invoice) => {
    setLoadingId(invoice.id);
    try {
      const url = await getInvoiceUrl(current.id, invoice.id);
      window.open(url, "_blank");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setLoadingId(undefined);
    }
  };

  const columns = invoiceColumns(timezone, (invoice) => (
    <Button
      loading={loadingId === invoice.id}
      size="sm"
      variant="ghost"
      onClick={() => void openInvoice(invoice)}
    >
      <ExternalLink aria-hidden="true" className="size-3.5" />
      View PDF
    </Button>
  ));

  return (
    <Card className="lg:col-span-2" padding="none">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">Invoices</h2>
      </div>
      <Table
        columns={columns}
        empty={<EmptyState className="m-4" title="No invoices yet." />}
        rowKey={(invoice) => invoice.id}
        rows={billing.invoices}
      />
    </Card>
  );
}

function PaymentCard({ billing }: { billing: Billing }) {
  const { can } = useWorkspace();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const updateUrl = billing.subscription.updatePaymentMethodUrl;
  const cancelUrl = billing.subscription.cancelUrl;

  const finishCancellation = () => {
    if (!cancelUrl) return;
    window.open(cancelUrl, "_blank");
    toast.info("Finish cancelling in the Paddle page we just opened.");
  };

  return (
    <Card title="Payment">
      {can("billing.manage") ? (
        <div className="flex flex-wrap gap-2">
          {updateUrl ? (
            <Button onClick={() => window.open(updateUrl, "_blank")}>Update payment method</Button>
          ) : (
            <Tooltip content="Available after the first payment">
              <Button disabled>Update payment method</Button>
            </Tooltip>
          )}
          <Button
            className="text-danger-700 hover:bg-danger-50"
            disabled={!cancelUrl}
            variant="ghost"
            onClick={() => setCancelOpen(true)}
          >
            Cancel subscription…
          </Button>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Only the owner can manage the subscription.</p>
      )}
      <ConfirmDialog
        body="Scheduled runs and checks stop when the current period ends. Your data stays readable for 30 days."
        confirmLabel="Continue"
        onClose={() => setCancelOpen(false)}
        onConfirm={finishCancellation}
        open={cancelOpen}
        title="Cancel the subscription?"
        tone="danger"
      />
    </Card>
  );
}

export default function BillingPage() {
  const { can, current } = useWorkspace();
  const allowed = can("billing.view");
  const billing = useQuery({
    enabled: allowed,
    queryFn: () => getBilling(current.id),
    queryKey: ["ws", current.id, "billing"],
  });

  if (!allowed) {
    return <AccessDenied message="Only owners and admins can view billing." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Usage & Billing" />
      {billing.isPending ? (
        <BillingSkeleton />
      ) : billing.isError ? (
        <ErrorState onRetry={() => void billing.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <PlanCard billing={billing.data} />
          <UsageCard billing={billing.data} />
          <InvoicesCard billing={billing.data} />
          <PaymentCard billing={billing.data} />
        </div>
      )}
    </div>
  );
}
