import { describe, expect, it } from "@jest/globals";

import type { Delivery } from "@/api/types";
import { formatEuros } from "@/lib/format";
import {
  deliveryAttempts,
  deliveryCostLabel,
  deliveryEvent,
  deliveryIncidentHref,
} from "./deliveries";

const failed: Delivery = {
  attemptCount: 2,
  costCents: null,
  createdAt: "2026-08-19T10:02:00.000Z",
  destinationCountry: null,
  errorSanitized: "provider unavailable",
  eventType: "FAILURE",
  id: "delivery_1",
  incidentId: "incident_1",
  providerMessageId: null,
  sentAt: null,
  status: "FAILED",
};

describe("delivery history", () => {
  it("maps delivery event badges and pluralizes attempts", () => {
    expect(deliveryEvent("FAILURE")).toEqual({ label: "Failure", tone: "danger" });
    expect(deliveryEvent("RECOVERY")).toEqual({ label: "Recovery", tone: "ok" });
    expect(deliveryEvent("TEST")).toEqual({ label: "Test", tone: "neutral" });
    expect(deliveryAttempts(1)).toBe("1 attempt");
    expect(deliveryAttempts(2)).toBe("2 attempts");
  });

  it("links a delivery to its incident when there is one", () => {
    expect(deliveryIncidentHref("ws_1", failed)).toBe("/w/ws_1/incidents/incident_1");
    expect(deliveryIncidentHref("ws_1", { incidentId: null })).toBeNull();
  });

  it("shows what a paid delivery cost", () => {
    expect(deliveryCostLabel(failed)).toBeNull();
    expect(deliveryCostLabel({ costCents: undefined, destinationCountry: undefined })).toBeNull();
    expect(deliveryCostLabel({ costCents: 18, destinationCountry: "Spain" })).toBe(`${formatEuros(18)} · Spain`);
    expect(deliveryCostLabel({ costCents: 18, destinationCountry: null })).toBe(formatEuros(18));
  });
});
