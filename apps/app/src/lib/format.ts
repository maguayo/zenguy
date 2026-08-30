import type { BillingCurrency } from "@/api/types";

const emDash = "—";

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(iso: string, timeZone: string): string {
  const date = validDate(iso);
  if (!date) return emDash;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone,
    year: "numeric",
  }).format(date);
}

export function formatTime(iso: string, timeZone: string): string {
  const date = validDate(iso);
  if (!date) return emDash;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone,
  }).format(date);
}

export function formatRelative(iso: string): string {
  const date = validDate(iso);
  if (!date) return emDash;
  const difference = date.getTime() - Date.now();
  const future = difference > 0;
  const absolute = Math.abs(difference);

  if (absolute < 1_000) return "now";
  if (absolute > 7 * 86_400_000) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  let amount: number;
  let suffix: string;
  if (absolute < 60_000) {
    amount = Math.max(1, Math.round(absolute / 1_000));
    suffix = "s";
  } else if (absolute < 3_600_000) {
    amount = Math.max(1, Math.round(absolute / 60_000));
    suffix = "m";
  } else if (absolute < 86_400_000) {
    amount = Math.max(1, Math.round(absolute / 3_600_000));
    suffix = "h";
  } else {
    amount = Math.max(1, Math.round(absolute / 86_400_000));
    suffix = "d";
  }
  return future ? `in ${amount}${suffix}` : `${amount}${suffix} ago`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return emDash;
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (totalMinutes > 0) return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatCurrency(cents: number, currency: BillingCurrency): string {
  return new Intl.NumberFormat(currency === "EUR" ? "es-ES" : "en-US", {
    currency,
    style: "currency",
  }).format(Math.round(cents) / 100);
}

/** Alert credit and paid-alert prices remain EUR-only. */
export function formatEuros(cents: number): string {
  return formatCurrency(cents, "EUR");
}

export function formatPct(value: number | null): string {
  if (value === null) return emDash;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`;
}

export function formatInterval(hours: number): string {
  return hours === 1 ? "Every hour" : `Every ${hours} hours`;
}

export function formatFrequency(seconds: number): string {
  if (seconds === 60) return "Every minute";
  if (seconds < 3_600) return `Every ${Math.round(seconds / 60)} min`;
  const hours = seconds / 3_600;
  return hours === 1 ? "Every hour" : `Every ${hours} hours`;
}
