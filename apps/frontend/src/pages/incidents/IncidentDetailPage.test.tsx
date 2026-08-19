import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { IncidentDelivery } from "../../api/types";
import { emptyDeliveriesCopy, incidentDeliveryColumns } from "./IncidentDetailPage";

const delivery: IncidentDelivery = {
  attemptCount: 2,
  channelName: "Ops Slack",
  channelType: "SLACK",
  createdAt: "2026-08-19T10:00:00.000Z",
  errorSanitized: "Webhook returned 404",
  eventType: "FAILURE",
  id: "delivery_1",
  sentAt: null,
  status: "FAILED",
};

describe("incident detail", () => {
  it("keeps notification delivery columns and sanitized failure evidence", () => {
    const columns = incidentDeliveryColumns("UTC");
    expect(columns.map((column) => column.key)).toEqual([
      "channel",
      "event",
      "status",
      "attempts",
      "time",
    ]);
    const html = renderToStaticMarkup(
      <>{columns.map((column) => <div key={column.key}>{column.render(delivery)}</div>)}</>,
    );
    expect(html).toContain("Ops Slack");
    expect(html).toContain("Failure");
    expect(html).toContain("Failed");
    expect(html).toContain("Webhook returned 404");
    expect(html).toContain(">2<");
  });

  it("keeps the required empty-deliveries copy verbatim", () => {
    expect(emptyDeliveriesCopy).toBe(
      "No notifications were configured when this incident opened.",
    );
  });
});
