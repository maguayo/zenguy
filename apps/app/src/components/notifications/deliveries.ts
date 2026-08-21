import type { Delivery } from "@/api/types";
import { formatEuros } from "@/lib/format";
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

/** "0,18 € · Spain" for paid deliveries; nothing for free channels or older payloads. */
export function deliveryCostLabel(
  delivery: Pick<Delivery, "costCents" | "destinationCountry">,
): string | null {
  if (typeof delivery.costCents !== "number") return null;
  const cost = formatEuros(delivery.costCents);
  return delivery.destinationCountry ? `${cost} · ${delivery.destinationCountry}` : cost;
}

export function deliveryIncidentHref(
  workspaceId: string,
  delivery: Pick<Delivery, "incidentId">,
): string | null {
  return delivery.incidentId ? `/w/${workspaceId}/incidents/${delivery.incidentId}` : null;
}
