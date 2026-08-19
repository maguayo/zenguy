import clsx from "clsx";

import type { Usage } from "../api/types";
import { formatDateTime, formatEuros } from "../lib/format";

export type UsageTone = "accent" | "warn" | "danger";

export function usageTone(usage: Usage): UsageTone {
  if (usage.overageRuns > 0) return "danger";
  if (usage.billableRuns / usage.includedRuns >= 0.8) return "warn";
  return "accent";
}

const barTone: Record<UsageTone, string> = {
  accent: "bg-accent-600",
  danger: "bg-danger-600",
  warn: "bg-warn-600",
};

function UsageRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium text-zinc-900">{value}</dd>
    </div>
  );
}

export function UsageMeter({ timezone, usage }: { timezone: string; usage: Usage }) {
  const tone = usageTone(usage);
  const percentage = Math.min(100, Math.max(0, (usage.billableRuns / usage.includedRuns) * 100));

  return (
    <div>
      <p className="text-sm font-medium text-zinc-900">
        {usage.billableRuns} of {usage.includedRuns} runs used
      </p>
      <div
        aria-label={`${usage.billableRuns} of ${usage.includedRuns} runs used`}
        aria-valuemax={usage.includedRuns}
        aria-valuemin={0}
        aria-valuenow={usage.billableRuns}
        className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100"
        role="progressbar"
      >
        <div
          className={clsx("h-full rounded-full transition-[width]", barTone[tone])}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <dl className="mt-4 space-y-2">
        <UsageRow label="Included runs" value={usage.includedRuns} />
        <UsageRow label="Used" value={usage.billableRuns} />
        <UsageRow label="Remaining" value={usage.remainingRuns} />
        {usage.overageRuns > 0 ? (
          <>
            <UsageRow label="Extra runs" value={usage.overageRuns} />
            <UsageRow label="Extra cost" value={formatEuros(usage.overageAmountCents)} />
          </>
        ) : null}
      </dl>

      <p className="mt-4 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
        Projected total {formatEuros(usage.projectedTotalCents)} · resets{" "}
        {formatDateTime(usage.periodEnd, timezone)}
      </p>
    </div>
  );
}
