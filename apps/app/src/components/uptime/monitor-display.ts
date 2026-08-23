import type { BodyCondition, Check, Monitor } from "@/api/types";
import { formatFrequency } from "@/lib/format";
import type { Tone } from "@/theme";
import type { FeatherIconName, PulseTick } from "@/ui";

// Presentation helpers ported from apps/frontend/src/pages/uptime/
// UptimeListPage.tsx and MonitorDetailPage.tsx.

const authorityPattern = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?([^/?#]+)/iu;

/**
 * Host (and explicit port) of a monitor URL, never its path or query string.
 * Parsed by hand because React Native's `URL` polyfill neither throws on
 * invalid input nor behaves like the WHATWG implementation used in tests.
 */
export function monitorHost(url: string): string {
  const match = authorityPattern.exec(url.trim());
  if (!match) return url;
  const scheme = (match[1] ?? "").toLowerCase();
  const authority = (match[2] ?? "").toLowerCase();
  const defaultPort = scheme === "https" ? ":443" : scheme === "http" ? ":80" : null;
  return defaultPort && authority.endsWith(defaultPort)
    ? authority.slice(0, -defaultPort.length)
    : authority;
}

export type StatTone = "ok" | "warn" | "danger" | "neutral";

export function uptimeTone(value: number | null): StatTone {
  if (value === null) return "neutral";
  if (value >= 99.9) return "ok";
  if (value >= 99) return "warn";
  return "danger";
}

export function expectationSummary(input: {
  bodyCondition: BodyCondition | null;
  bodyConditionPath: string | null;
  bodyExpectedValue: string | null;
  expectedStatus: number;
}): string {
  const parts = [`Status ${input.expectedStatus}`];
  const expected = input.bodyExpectedValue ?? "";
  if (input.bodyCondition === "CONTAINS") parts.push(`Body contains "${expected}"`);
  if (input.bodyCondition === "NOT_CONTAINS") parts.push(`Body does not contain "${expected}"`);
  if (input.bodyCondition === "EQUALS") parts.push(`Body equals "${expected}"`);
  if (input.bodyCondition === "JSON_PATH_EQUALS") {
    parts.push(`JSON path ${input.bodyConditionPath ?? "—"} equals "${expected}"`);
  }
  return parts.join(" · ");
}

export function monitorHeaderLines(
  monitor: Pick<Monitor, "headers" | "headersMasked">,
): string[] {
  if (monitor.headersMasked) return ["Masked for your role"];
  if (!monitor.headers || monitor.headers.length === 0) return ["None"];
  return monitor.headers.map((header) => `${header.key}: ${header.value}`);
}

export function formatResponseTime(ms: number | null): string {
  return ms === null ? "—" : `${ms} ms`;
}

export function retriesLabel(maxRetries: number): string {
  return `${maxRetries} ${maxRetries === 1 ? "retry" : "retries"}`;
}

export interface CheckSummary {
  httpStatus: string;
  reason: string;
  responseTime: string;
  result: "Passed" | "Failed";
  tone: "ok" | "danger";
}

/** The "Recent checks" columns of the web table, as plain strings for a row. */
export function checkSummary(check: Check): CheckSummary {
  const passed = check.status === "PASSED";
  return {
    httpStatus: check.httpStatus === null ? "—" : String(check.httpStatus),
    reason: check.failureReason ?? "—",
    responseTime: formatResponseTime(check.responseTimeMs),
    result: passed ? "Passed" : "Failed",
    tone: passed ? "ok" : "danger",
  };
}

/** Leading tile of a monitor row: its status tone, "in motion" while checking. */
export function monitorTile(monitor: Pick<Monitor, "checking" | "status">): { icon: FeatherIconName; tone: Tone } {
  if (monitor.checking) return { icon: "activity", tone: "info" };
  if (monitor.status === "UP") return { icon: "check", tone: "ok" };
  if (monitor.status === "DOWN") return { icon: "x", tone: "danger" };
  return { icon: "activity", tone: "neutral" };
}

/** "GET · Every 5 min · 184 ms" — the measured line of a monitor row. */
export function monitorMeta(
  monitor: Pick<Monitor, "frequencySeconds" | "lastResponseTimeMs" | "method">,
): string {
  return `${monitor.method} · ${formatFrequency(monitor.frequencySeconds)} · ${formatResponseTime(monitor.lastResponseTimeMs)}`;
}

/** Pulse ticks for the newest `max` checks (API order is newest first), oldest first. */
export function checkTicks(checks: Pick<Check, "id" | "status">[], max = 24): PulseTick[] {
  return checks
    .slice(0, max)
    .reverse()
    .map((check) => ({ key: check.id, tone: check.status === "PASSED" ? "ok" : "danger" }));
}
