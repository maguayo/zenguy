export type BadgeTone = "danger" | "neutral" | "ok" | "warn";

const TONE_CLASS: Record<BadgeTone, string> = {
  danger: "bg-danger-50 text-danger-700",
  neutral: "bg-zinc-100 text-zinc-600",
  ok: "bg-ok-50 text-ok-700",
  warn: "bg-warn-50 text-warn-600",
};

const TONE_BY_STATUS: Record<string, BadgeTone> = {
  DOWN: "danger",
  FAILED: "danger",
  OFFLINE: "danger",
  ONLINE: "ok",
  PASSED: "ok",
  SYSTEM_ERROR: "warn",
  TIMEOUT: "warn",
  UP: "ok",
};

/** Queued, running and anything unrecognised stay neutral: they are not verdicts. */
export function badgeTone(status: string): BadgeTone {
  return TONE_BY_STATUS[status.toUpperCase()] ?? "neutral";
}

export interface StatusBadgeProps {
  label: string;
  /** The status behind the label, when the label carries extra text ("UP 3"). */
  status?: string;
}

export function StatusBadge({ label, status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${TONE_CLASS[badgeTone(status ?? label)]}`}
    >
      {label}
    </span>
  );
}
