import type { Delivery } from "@/api/types";
import type { Tone } from "@/theme";

const eventLabels: Record<Delivery["eventType"], { label: string; tone: Tone }> = {
  FAILURE: { label: "Failure", tone: "danger" },
  RECOVERY: { label: "Recovery", tone: "ok" },
  TEST: { label: "Test", tone: "neutral" },
};

export function deliveryAttempts(count: number): string {
  return `${count} ${count === 1 ? "attempt" : "attempts"}`;
}

export function deliveryEvent(eventType: Delivery["eventType"]): { label: string; tone: Tone } {
  return eventLabels[eventType];
}

export function deliveryIncidentHref(
  workspaceId: string,
  delivery: Pick<Delivery, "incidentId">,
): string | null {
  return delivery.incidentId ? `/w/${workspaceId}/incidents/${delivery.incidentId}` : null;
}
