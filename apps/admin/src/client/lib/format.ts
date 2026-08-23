const EM_DASH = "—";

/**
 * An elapsed span in its two most significant units: "3s", "90s", "2m 4s",
 * "2h 0m", "2d 2h". Anything under two minutes stays in raw seconds because
 * worker staleness is judged against a 15s heartbeat window, where "75s ago"
 * reads faster than "1m 15s ago".
 */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 120) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * How long ago `from` happened, measured against an explicit `now` so freshness
 * can be computed against the server clock that produced the data.
 */
export function relativeSeconds(from: number, now: number): string {
  return `${formatElapsed(now - from)} ago`;
}

/** A run duration: "0.9s", "42s", "1m 04s", "3h 04m", "—" when unknown. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return EM_DASH;
  const total = Math.max(0, ms);
  // Rounded on the integer millisecond count: 0.85 is not representable, so
  // (850 / 1_000).toFixed(1) would report 0.8s.
  if (total < 1_000) return `${(Math.round(total / 100) / 10).toFixed(1)}s`;
  const totalSeconds = Math.floor(total / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (totalMinutes > 0) return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** An absolute timestamp in the operator's own time zone. */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/** A 0..1 ratio as a whole percentage: "83%", "—" when there is nothing to rate. */
export function percent(ratio: number | null): string {
  if (ratio === null) return EM_DASH;
  return `${Math.round(ratio * 100)}%`;
}

/** Counts with thousands separators, so five-digit totals stay scannable. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

/** A change with its sign always shown, using a real minus sign: "+12", "−3", "0". */
export function formatSigned(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`;
}
