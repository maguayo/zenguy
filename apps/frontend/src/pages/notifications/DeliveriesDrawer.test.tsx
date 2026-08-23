import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { Delivery } from "../../api/types";
import { DeliveryRow, deliveryAttempts, deliveryEvent } from "./DeliveriesDrawer";

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

  it("renders failed status, sanitized error, date, and incident link", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DeliveryRow delivery={failed} timezone="UTC" workspaceId="ws_1" />
      </MemoryRouter>,
    );
    expect(html).toContain("Failure");
    expect(html).toContain("Failed");
    expect(html).toContain("2 attempts");
    expect(html).toContain("provider unavailable");
    expect(html).toContain("19 Aug 2026, 10:02");
    expect(html).toContain('/w/ws_1/incidents/incident_1');
    expect(html).toContain('aria-label="Open incident"');
  });

  it("shows what a paid delivery cost", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DeliveryRow
          delivery={{
            ...failed,
            costCents: 18,
            destinationCountry: "Spain",
            errorSanitized: null,
            status: "SENT",
          }}
          timezone="UTC"
          workspaceId="ws_1"
        />
      </MemoryRouter>,
    );
    expect(html).toContain("0,18");
    expect(html).toContain("Spain");
  });

  it("surfaces an ambiguous provider outcome instead of calling it pending", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DeliveryRow
          delivery={{
            ...failed,
            attemptCount: 1,
            errorSanitized: "provider acknowledgement lost",
            status: "AMBIGUOUS",
          }}
          timezone="UTC"
          workspaceId="ws_1"
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Needs reconciliation");
    expect(html).toContain("provider acknowledgement lost");
  });
});
