import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { MessageSquare, Phone, ShieldCheck, Wallet } from "lucide-react";

import {
  alertsQueryKey,
  getAlertsOverview,
  listCreditEntries,
  startCreditTopUp,
  updateAlertSettings,
} from "../../api/alerts";
import { getBillingConfig } from "../../api/billing";
import type {
  AlertsOverview,
  CreditEntry,
  CreditEntryKind,
  PricingTable,
} from "../../api/types";
import { Badge, type BadgeProps } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { LoadMore } from "../../components/ui/LoadMore";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { Table, type TableColumn } from "../../components/ui/Table";
import { Toggle } from "../../components/ui/Toggle";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import type { ApiPage } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";
import { formatDateTime, formatEuros } from "../../lib/format";
import { initPaddle, loadPaddle, openCheckout } from "../../lib/paddle";
import { AlertsTabs } from "./AlertsTabs";

export const paidAlertsDescription =
  "Pay-as-you-go SMS and calls, charged from prepaid credit. Email, mobile push, Slack and Discord alerts are always free.";

export function statusCopy(overview: AlertsOverview): {
  label: string;
  tone: NonNullable<BadgeProps["tone"]>;
  detail: string;
} {
  if (!overview.settings.paidChannelsEnabled) {
    return {
      label: "Off",
      tone: "neutral",
      detail:
        "SMS, call and WhatsApp channels are paused and nothing is charged. Email, mobile push, Slack and Discord keep working.",
    };
  }
  if (overview.status.pauseReason === "NO_CREDIT") {
    return {
      label: "Paused — no credit",
      tone: "danger",
      detail:
        "SMS and call alerts are on, but the credit is empty, so phone channels are skipped until you top up.",
    };
  }
  return {
    label: "On",
    tone: "ok",
    detail:
      "Each SMS or call is charged from your credit at the destination rate below. Nothing else is billed.",
  };
}

export function topUpCopy(overview: AlertsOverview): string | null {
  if (overview.topUp.available) return null;
  return "Top-ups aren't available yet. You can review prices now; SMS & calls can be turned on as soon as top-ups open.";
}

export function packOptions(overview: AlertsOverview): number[] {
  const { minPacks, maxPacks } = overview.topUp;
  return Array.from({ length: maxPacks - minPacks + 1 }, (_, index) => minPacks + index);
}

export interface PricingRow {
  callCents: number;
  channels: number;
  key: string;
  name: string;
  region: string;
  smsCents: number;
}

export function pricingRows(
  pricing: PricingTable,
  destinations: AlertsOverview["destinations"] = [],
): PricingRow[] {
  const configured = new Map(destinations.map((entry) => [entry.name, entry.channels]));
  return pricing.regions.flatMap((region) => {
    if (region.flat) {
      const other = destinations
        .filter((entry) => entry.iso === null)
        .reduce((total, entry) => total + entry.channels, 0);
      return [
        {
          callCents: region.flat.callCents,
          channels: other,
          key: region.key,
          name: region.name,
          region: region.name,
          smsCents: region.flat.smsCents,
        },
      ];
    }
    return region.countries.map((country) => ({
      callCents: country.callCents,
      channels: configured.get(country.name) ?? 0,
      key: country.iso,
      name: country.name,
      region: region.name,
      smsCents: country.smsCents,
    }));
  });
}

const entryKindLabels: Record<CreditEntryKind, string> = {
  ADJUSTMENT: "Adjustment",
  CHARGE: "Alert",
  GRANT: "Complimentary credit",
  REFUND: "Refund",
  TOPUP: "Top-up",
};

export function entryPresentation(entry: CreditEntry): {
  amount: string;
  kind: string;
  tone: "positive" | "negative";
} {
  const positive = entry.amountCents >= 0;
  return {
    amount: `${positive ? "+" : "−"}${formatEuros(Math.abs(entry.amountCents))}`,
    kind: entryKindLabels[entry.kind],
    tone: positive ? "positive" : "negative",
  };
}

export async function pollUntilCredited(
  fetchOverview: () => Promise<AlertsOverview>,
  previousBalanceCents: number,
  {
    maxChecks = 30,
    wait = (milliseconds: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)),
  }: { maxChecks?: number; wait?: (milliseconds: number) => Promise<void> } = {},
): Promise<boolean> {
  for (let check = 0; check < maxChecks; check += 1) {
    const overview = await fetchOverview();
    if ((overview.credit?.balanceCents ?? 0) > previousBalanceCents) return true;
    if (check < maxChecks - 1) await wait(2_000);
  }
  return false;
}

function useInvalidateAlerts() {
  const queryClient = useQueryClient();
  const { current } = useWorkspace();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: alertsQueryKey(current.id) }),
      queryClient.invalidateQueries({ queryKey: ["ws", current.id, "channels"] }),
    ]);
}

function StatusCard({ overview }: { overview: AlertsOverview }) {
  const { can, current } = useWorkspace();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const invalidate = useInvalidateAlerts();
  const status = statusCopy(overview);
  const unavailable = topUpCopy(overview);
  const canToggle = can("channels.manage");
  const toggle = useMutation({
    mutationFn: (paidChannelsEnabled: boolean) =>
      updateAlertSettings(current.id, { paidChannelsEnabled }),
  });
  const enabled = overview.settings.paidChannelsEnabled;
  const lockedOff = !enabled && !overview.topUp.available && (overview.credit?.balanceCents ?? 0) <= 0;

  const change = async (next: boolean) => {
    try {
      await toggle.mutateAsync(next);
      toast.success(next ? "SMS & calls turned on" : "SMS & calls turned off");
      await invalidate();
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  return (
    <Card title="SMS & calls">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold text-zinc-900">Phone alerts</p>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-2 text-sm text-zinc-600">{status.detail}</p>
        </div>
        {canToggle ? (
          <Toggle
            aria-label="SMS & calls"
            checked={enabled}
            disabled={toggle.isPending || lockedOff}
            onCheckedChange={(next) => void change(next)}
          />
        ) : null}
      </div>
      {unavailable && !enabled ? (
        <p className="mt-4 rounded-md border border-info-600/20 bg-info-50 p-3 text-sm text-zinc-700">
          {unavailable}
        </p>
      ) : null}
      {!canToggle ? (
        <p className="mt-4 text-xs text-zinc-500">Only owners and admins can change this.</p>
      ) : null}
      <ul className="mt-4 space-y-1.5 text-xs text-zinc-500">
        <li className="flex items-center gap-2">
          <MessageSquare aria-hidden="true" className="size-3.5" />
          One SMS per alert, trimmed to a single 160-character message.
        </li>
        <li className="flex items-center gap-2">
          <Phone aria-hidden="true" className="size-3.5" />
          One call per alert, capped at one minute, read twice.
        </li>
      </ul>
    </Card>
  );
}

function TopUpModal({
  onClose,
  open,
  overview,
}: {
  onClose: () => void;
  open: boolean;
  overview: AlertsOverview;
}) {
  const { current } = useWorkspace();
  const { user } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateAlerts();
  const [packs, setPacks] = useState(overview.topUp.minPacks);
  const [phase, setPhase] = useState<"idle" | "opening" | "confirming">("idle");
  const previousBalance = useRef(overview.credit?.balanceCents ?? 0);

  useEffect(() => {
    if (open) setPacks(overview.topUp.minPacks);
  }, [open, overview.topUp.minPacks]);

  const confirm = async () => {
    setPhase("confirming");
    try {
      const credited = await pollUntilCredited(
        () => getAlertsOverview(current.id),
        previousBalance.current,
      );
      await invalidate();
      if (credited) toast.success("Credit added");
      else toast.info("Payment received — the credit will appear shortly.");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setPhase("idle");
    }
  };

  const start = async () => {
    setPhase("opening");
    try {
      previousBalance.current = overview.credit?.balanceCents ?? 0;
      const checkout = await startCreditTopUp(current.id, packs);
      const config = await getBillingConfig();
      if (config.mode !== "paddle") {
        throw new Error("Top-ups are not available yet.");
      }
      await loadPaddle();
      await initPaddle(config);
      openCheckout({
        customData: checkout.customData,
        email: user?.email ?? "",
        onCompleted: () => void confirm(),
        priceId: checkout.priceId,
        quantity: checkout.quantity,
        workspaceId: current.id,
      });
      onClose();
      setPhase("idle");
    } catch (error) {
      setPhase("idle");
      toast.error(apiErrorMessage(error));
    }
  };

  return (
    <Modal
      footer={
        <>
          <Button disabled={phase !== "idle"} onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={phase === "opening"}
            variant="primary"
            onClick={() => void start()}
          >
            Continue to payment
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title="Top up alert credit"
    >
      <div className="space-y-4">
        <Field
          hint="Credit never expires and is only spent on SMS, calls and WhatsApp alerts you configure."
          htmlFor="topup-packs"
          label="Amount"
        >
          <Select
            id="topup-packs"
            value={packs}
            onChange={(event) => setPacks(Number(event.target.value))}
          >
            {packOptions(overview).map((count) => (
              <option key={count} value={count}>
                {formatEuros(count * overview.topUp.packCents)}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-zinc-500">
          Payment is handled by Paddle in a secure overlay. Tax is added at checkout; the full
          amount above is credited to this workspace.
        </p>
      </div>
    </Modal>
  );
}

function CreditCard({ overview }: { overview: AlertsOverview }) {
  const { can } = useWorkspace();
  const [topUpOpen, setTopUpOpen] = useState(false);
  const credit = overview.credit;
  if (credit === null) {
    return (
      <Card title="Credit">
        <p className="text-sm text-zinc-500">
          Only owners and admins can see the balance and history.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Credit">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-3xl font-semibold tracking-tight text-zinc-950">
            {formatEuros(credit.balanceCents)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">available alert credit</p>
        </div>
        {can("billing.manage") ? (
          <Button
            disabled={!overview.topUp.available}
            variant="primary"
            onClick={() => setTopUpOpen(true)}
          >
            <Wallet aria-hidden="true" className="size-4" />
            Top up
          </Button>
        ) : (
          <p className="text-xs text-zinc-500">Only the owner can top up.</p>
        )}
      </div>
      {credit.lowBalance && overview.settings.paidChannelsEnabled ? (
        <p className="mt-4 rounded-md border border-warn-600/25 bg-warn-50 p-3 text-sm text-zinc-800">
          Below {formatEuros(credit.lowBalanceThresholdCents)} — top up to keep SMS and calls
          flowing.
        </p>
      ) : null}
      <p className="mt-4 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
        {credit.paidAlertsLast24h} of {overview.settings.dailyPaidAlertLimit} paid alerts used in
        the last 24 hours
      </p>
      <TopUpModal onClose={() => setTopUpOpen(false)} open={topUpOpen} overview={overview} />
    </Card>
  );
}

function ProtectionsCard({ overview }: { overview: AlertsOverview }) {
  const { can, current } = useWorkspace();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const invalidate = useInvalidateAlerts();
  const [limit, setLimit] = useState(String(overview.settings.dailyPaidAlertLimit));
  const save = useMutation({
    mutationFn: (dailyPaidAlertLimit: number) =>
      updateAlertSettings(current.id, { dailyPaidAlertLimit }),
  });

  useEffect(() => {
    setLimit(String(overview.settings.dailyPaidAlertLimit));
  }, [overview.settings.dailyPaidAlertLimit]);

  const parsed = Number(limit);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 200;
  const submit = async () => {
    if (!valid) return;
    try {
      await save.mutateAsync(parsed);
      toast.success("Daily limit saved");
      await invalidate();
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  return (
    <Card title="Protections">
      {can("channels.manage") ? (
        <form
          className="flex flex-wrap items-end gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="w-40">
            <Field
              error={valid ? undefined : "Between 1 and 200."}
              htmlFor="daily-paid-limit"
              label="Max paid alerts per 24 h"
            >
              <Input
                id="daily-paid-limit"
                inputMode="numeric"
                invalid={!valid}
                max={200}
                min={1}
                type="number"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
              />
            </Field>
          </div>
          <Button
            disabled={!valid || parsed === overview.settings.dailyPaidAlertLimit}
            loading={save.isPending}
            type="submit"
          >
            Save
          </Button>
        </form>
      ) : (
        <p className="text-sm text-zinc-700">
          Max paid alerts per 24 h:{" "}
          <span className="font-medium">{overview.settings.dailyPaidAlertLimit}</span>
        </p>
      )}
      <ul className="mt-4 space-y-2 text-sm text-zinc-600">
        <li className="flex gap-2">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ok-600" />
          One failure alert and one recovery alert per incident, per channel — never one per
          failed check.
        </li>
        <li className="flex gap-2">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ok-600" />
          When the credit runs out only phone channels pause; email, Slack and Discord keep
          working and the owner is emailed once.
        </li>
        <li className="flex gap-2">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ok-600" />
          Credit can never go negative: an alert is charged before it is sent and refunded if
          the carrier rejects it.
        </li>
      </ul>
    </Card>
  );
}

export function pricingColumns(): TableColumn<PricingRow>[] {
  return [
    {
      header: "Destination",
      key: "destination",
      render: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-zinc-900">{row.name}</span>
          {row.channels > 0 ? (
            <Badge tone="accent">
              {row.channels} {row.channels === 1 ? "channel" : "channels"}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      className: "text-right",
      header: "SMS",
      key: "sms",
      render: (row) => <span className="whitespace-nowrap">{formatEuros(row.smsCents)}</span>,
    },
    {
      className: "text-right",
      header: "Call",
      key: "call",
      render: (row) => <span className="whitespace-nowrap">{formatEuros(row.callCents)}</span>,
    },
  ];
}

function PricingCard({ overview }: { overview: AlertsOverview }) {
  const rows = pricingRows(overview.pricing, overview.destinations);
  const columns = pricingColumns();
  const regions = overview.pricing.regions.map((region) => region.name);

  return (
    <Card className="lg:col-span-2" padding="none">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">Price per alert</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Charged from your credit per SMS or call sent. Destinations you have configured are
          highlighted.
        </p>
      </div>
      <div className="grid gap-0 divide-y divide-zinc-200 lg:grid-cols-[1fr_1.4fr_1fr] lg:divide-x lg:divide-y-0">
        {regions.map((regionName) => (
          <div key={regionName} className="min-w-0">
            <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {regionName}
            </p>
            <Table
              columns={columns}
              rowKey={(row) => row.key}
              rows={rows.filter((row) => row.region === regionName)}
            />
          </div>
        ))}
      </div>
      <p className="border-t border-zinc-200 px-4 py-3 text-xs text-zinc-500">
        Prices are based on carrier rates for our number and may change. Your configured
        channels always show their current price.
      </p>
    </Card>
  );
}

function HistoryCard() {
  const { current, timezone } = useWorkspace();
  const entries = useInfiniteQuery<ApiPage<CreditEntry>>({
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listCreditEntries(current.id, { cursor: pageParam as string | null, limit: 25 }),
    queryKey: [...alertsQueryKey(current.id), "credit-entries"],
  });
  const rows = entries.data?.pages.flatMap((page) => page.items) ?? [];
  const columns: TableColumn<CreditEntry>[] = [
    {
      header: "Date",
      key: "date",
      render: (entry) => (
        <span className="whitespace-nowrap">{formatDateTime(entry.createdAt, timezone)}</span>
      ),
    },
    {
      header: "Description",
      key: "description",
      render: (entry) => (
        <div>
          <p className="text-zinc-900">{entry.description}</p>
          <p className="text-xs text-zinc-500">{entryPresentation(entry).kind}</p>
        </div>
      ),
    },
    {
      className: "text-right",
      header: "Amount",
      key: "amount",
      render: (entry) => {
        const presentation = entryPresentation(entry);
        return (
          <span
            className={
              presentation.tone === "positive"
                ? "whitespace-nowrap font-medium text-ok-700"
                : "whitespace-nowrap text-zinc-900"
            }
          >
            {presentation.amount}
          </span>
        );
      },
    },
    {
      className: "text-right",
      header: "Balance",
      key: "balance",
      render: (entry) => (
        <span className="whitespace-nowrap">{formatEuros(entry.balanceAfterCents)}</span>
      ),
    },
  ];

  return (
    <Card className="lg:col-span-2" padding="none">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">History</h2>
      </div>
      {entries.isError ? (
        <ErrorState className="m-4" onRetry={() => void entries.refetch()} />
      ) : (
        <>
          <Table
            columns={columns}
            empty={<EmptyState className="m-4" title="No credit activity yet." />}
            loading={entries.isPending}
            rowKey={(entry) => entry.id}
            rows={rows}
          />
          <div className="px-4 pb-4">
            <LoadMore
              loading={entries.isFetchingNextPage}
              nextCursor={
                entries.hasNextPage ? (entries.data?.pages.at(-1)?.nextCursor ?? null) : null
              }
              onMore={() => void entries.fetchNextPage()}
            />
          </div>
        </>
      )}
    </Card>
  );
}

function PageSkeleton(): ReactNode {
  return (
    <div aria-label="Loading SMS & calls" className="grid gap-4 lg:grid-cols-2" role="status">
      {Array.from({ length: 3 }, (_, index) => (
        <Card key={index} className="min-h-40 space-y-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
        </Card>
      ))}
    </div>
  );
}

export default function PaidAlertsPage() {
  const { can, current } = useWorkspace();
  const overview = useQuery({
    queryFn: () => getAlertsOverview(current.id),
    queryKey: alertsQueryKey(current.id),
  });

  return (
    <div className="space-y-6">
      <AlertsTabs active="sms-calls" description={paidAlertsDescription} />
      {overview.isPending ? (
        <PageSkeleton />
      ) : overview.isError ? (
        <ErrorState onRetry={() => void overview.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <StatusCard overview={overview.data} />
          <CreditCard overview={overview.data} />
          <ProtectionsCard overview={overview.data} />
          <PricingCard overview={overview.data} />
          {can("billing.view") ? <HistoryCard /> : null}
        </div>
      )}
    </div>
  );
}
