import { truncate } from "../../shared/redact";
import type { NotificationMessage } from "./notifier";

export interface NotificationTemplateInput {
  eventType: "FAILURE" | "RECOVERY" | "TEST";
  resourceType: "BROWSER_TEST" | "UPTIME_MONITOR";
  resourceName: string;
  workspaceName: string;
  appUrl: string;
  workspaceId: string;
  incidentId?: string;
  runId?: string;
  occurredAtIso: string;
  durationMs?: number;
  failureSummary?: string;
}

const URL = /\bhttps?:\/\/[^\s<>"']+/giu;

function notificationLink(input: NotificationTemplateInput): string {
  const workspaceUrl = `${input.appUrl.replace(/\/+$/u, "")}/w/${input.workspaceId}`;
  if (input.incidentId !== undefined) {
    return `${workspaceUrl}/incidents/${input.incidentId}`;
  }
  if (input.runId !== undefined) {
    return `${workspaceUrl}/runs/${input.runId}`;
  }
  return `${workspaceUrl}/notifications`;
}

function safeFailureSummary(summary: string): string {
  return truncate(summary.replace(URL, "[redacted-url]"), 200);
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Number.isFinite(durationMs)
    ? Math.max(0, Math.floor(durationMs / 1_000))
    : 0;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function buildNotificationMessage(
  input: NotificationTemplateInput,
): NotificationMessage {
  const link = notificationLink(input);

  if (input.eventType === "TEST") {
    return {
      eventType: "TEST",
      title: "Zenguy test notification",
      lines: [
        "This is a test notification for channel verification. No action needed.",
      ],
      link,
      speakText: "This is a test notification from Zenguy.",
      shortText: "Zenguy test notification.",
      color: "gray",
    };
  }

  const resourceLabel =
    input.resourceType === "BROWSER_TEST" ? "browser test" : "uptime monitor";

  if (input.eventType === "RECOVERY") {
    return {
      eventType: "RECOVERY",
      title: `✅ ${input.resourceName} recovered`,
      lines: [
        `"${input.resourceName}" has recovered.`,
        `Downtime: ${formatDuration(input.durationMs ?? 0)}`,
        `Workspace: ${input.workspaceName}`,
        `When: ${input.occurredAtIso}`,
      ],
      link,
      speakText: `Zenguy alert. The ${input.resourceName} has recovered.`,
      shortText: `Zenguy: RECOVERED ${input.resourceName} (${resourceLabel}). ${link}`,
      color: "green",
    };
  }

  const browserTest = input.resourceType === "BROWSER_TEST";
  const lines = [
    browserTest
      ? `Browser test "${input.resourceName}" failed after all configured retries.`
      : `Uptime monitor "${input.resourceName}" is down after all configured retries.`,
    `Workspace: ${input.workspaceName}`,
    `When: ${input.occurredAtIso}`,
  ];
  if (input.failureSummary !== undefined && input.failureSummary.length > 0) {
    lines.push(`Summary: ${safeFailureSummary(input.failureSummary)}`);
  }

  return {
    eventType: "FAILURE",
    title: browserTest
      ? `❌ ${input.resourceName} failed`
      : `🔴 ${input.resourceName} is down`,
    lines,
    link,
    speakText: browserTest
      ? `Zenguy alert. The ${input.resourceName} browser test has failed after all configured retries.`
      : `Zenguy alert. The ${input.resourceName} uptime monitor is down after all configured retries.`,
    shortText: `Zenguy: ${browserTest ? "FAILED" : "DOWN"} ${input.resourceName} (${resourceLabel}). ${link}`,
    color: "red",
  };
}
