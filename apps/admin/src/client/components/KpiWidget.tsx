import type { ReactNode } from "react";

const TONE_CLASS = {
  danger: "text-danger-700",
  default: "text-zinc-900",
  ok: "text-ok-700",
} as const;

export type KpiTone = keyof typeof TONE_CLASS;

/** One stacked hero stat: label on top, the number doing the talking, a hint under. */
export function KpiWidget({
  hint,
  label,
  tone = "default",
  value,
}: {
  hint?: ReactNode;
  label: string;
  tone?: KpiTone;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${TONE_CLASS[tone]}`}>
        {value}
      </p>
      {hint === undefined ? null : <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
