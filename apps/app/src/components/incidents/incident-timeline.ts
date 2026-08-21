import type { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";

import type { IncidentDetail, IncidentEvent } from "@/api/types";
import type { Tone } from "@/theme";

type FeatherName = ComponentProps<typeof Feather>["name"];

export interface TimelineEventPresentation {
  icon: FeatherName;
  tone: Tone;
}

/** Dot colour and glyph per event type, mirroring the web timeline. */
export const eventPresentation: Record<IncidentEvent["type"], TimelineEventPresentation> = {
  FAILURE_RECORDED: { icon: "x-circle", tone: "danger" },
  MONITOR_DELETED: { icon: "trash-2", tone: "neutral" },
  NOTIFICATION_FAILED: { icon: "alert-triangle", tone: "warn" },
  NOTIFICATION_SENT: { icon: "send", tone: "info" },
  OPENED: { icon: "alert-octagon", tone: "danger" },
  RESOLVED: { icon: "check-circle", tone: "ok" },
  TEST_DELETED: { icon: "trash-2", tone: "neutral" },
};

export function metadataString(
  metadata: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function sortedIncidentEvents(events: IncidentEvent[]): IncidentEvent[] {
  return [...events].sort((left, right) => {
    const difference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return difference || left.id.localeCompare(right.id);
  });
}

export function eventEvidenceIds(event: IncidentEvent): { checkId: string | null; runId: string | null } {
  const runFromMessage = /\bRun\s+([A-Za-z0-9_-]+)/u.exec(event.message)?.[1] ?? null;
  const checkFromMessage = /\bCheck\s+([A-Za-z0-9_-]+)/u.exec(event.message)?.[1] ?? null;
  return {
    checkId: metadataString(event.metadata, "checkId") ?? checkFromMessage,
    runId: metadataString(event.metadata, "runId") ?? runFromMessage,
  };
}

export function deliveryStatusTone(status: string): Tone {
  return status === "SENT" ? "ok" : status === "FAILED" ? "danger" : "neutral";
}

export function deliveryStatusLabel(status: string): string {
  return status.toLowerCase().replace(/^./u, (letter) => letter.toUpperCase());
}

export interface TimelineChip {
  /** In-app path opened on tap; plain badges have none. */
  href?: string;
  key: string;
  label: string;
  mono?: boolean;
  tone: Tone;
}

/** Compact metadata for an event: channel, delivery status and run/check evidence. */
export function timelineChips(
  event: IncidentEvent,
  incident: Pick<IncidentDetail, "resourceId" | "resourceType">,
  workspaceId: string,
): TimelineChip[] {
  const chips: TimelineChip[] = [];
  const channelName = metadataString(event.metadata, "channelName");
  if (channelName) chips.push({ key: "channel", label: channelName, tone: "neutral" });
  const deliveryStatus = metadataString(event.metadata, "status");
  if (deliveryStatus) {
    chips.push({
      key: "status",
      label: deliveryStatusLabel(deliveryStatus),
      tone: deliveryStatusTone(deliveryStatus),
    });
  }
  const { checkId, runId } = eventEvidenceIds(event);
  if (runId) {
    chips.push({
      href: `/w/${workspaceId}/runs/${runId}`,
      key: "run",
      label: `Run ${runId}`,
      mono: true,
      tone: "accent",
    });
  }
  if (checkId) {
    chips.push({
      href: `/w/${workspaceId}/uptime/${incident.resourceId}?check=${encodeURIComponent(checkId)}`,
      key: "check",
      label: `Check ${checkId}`,
      mono: true,
      tone: "accent",
    });
  }
  return chips;
}
