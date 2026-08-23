import { describe, expect, it } from "@jest/globals";

import type { IncidentDelivery } from "@/api/types";
import { formatEuros } from "@/lib/format";
import {
  emptyDeliveriesCopy,
  incidentDeliveryCost,
  incidentDeliveryEvent,
  incidentDeliveryStatus,
  incidentDeliveryTime,
  incidentMeta,
  incidentResourceHref,
  incidentResourceLabel,
  openedByLink,
} from "./incident-detail";

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
  it("links the incident back to its resource", () => {
    expect(incidentResourceHref("ws_1", { resourceId: "test_1", resourceType: "BROWSER_TEST" })).toBe(
      "/w/ws_1/tests/test_1",
    );
    expect(incidentResourceHref("ws_1", { resourceId: "mon_1", resourceType: "UPTIME_MONITOR" })).toBe(
      "/w/ws_1/uptime/mon_1",
    );
    expect(incidentResourceLabel("BROWSER_TEST")).toBe("browser test");
    expect(incidentResourceLabel("UPTIME_MONITOR")).toBe("monitor");
  });

  it("links the failing run or check that opened the incident", () => {
    expect(openedByLink("ws_1", { openedByCheckId: null, openedByRunId: "run_1", resourceId: "test_1" })).toEqual({
      href: "/w/ws_1/runs/run_1",
      label: "Run run_1",
    });
    expect(openedByLink("ws_1", { openedByCheckId: "chk 1", openedByRunId: null, resourceId: "mon_1" })).toEqual({
      href: "/w/ws_1/uptime/mon_1?check=chk%201",
      label: "Check chk 1",
    });
    expect(openedByLink("ws_1", { openedByCheckId: null, openedByRunId: null, resourceId: "mon_1" })).toBeNull();
  });

  it("summarises opened, duration and resolved times", () => {
    expect(incidentMeta({ openedAt: "2026-08-19T10:00:00.000Z", resolvedAt: null }, 120_000, "UTC")).toBe(
      "Opened 19 Aug 2026, 10:00 · 2m 00s",
    );
    expect(
      incidentMeta(
        { openedAt: "2026-08-19T10:00:00.000Z", resolvedAt: "2026-08-19T10:05:00.000Z" },
        300_000,
        "UTC",
      ),
    ).toBe("Opened 19 Aug 2026, 10:00 · 5m 00s · Resolved 19 Aug 2026, 10:05");
  });

  it("keeps delivery event, status, cost and time like the web table", () => {
    expect(incidentDeliveryEvent("FAILURE")).toBe("Failure");
    expect(incidentDeliveryEvent("RECOVERY")).toBe("Recovery");
    expect(incidentDeliveryStatus("SENT")).toEqual({ label: "Sent", tone: "ok" });
    expect(incidentDeliveryStatus("FAILED")).toEqual({ label: "Failed", tone: "danger" });
    expect(incidentDeliveryStatus("AMBIGUOUS")).toEqual({
      label: "Needs reconciliation",
      tone: "warn",
    });
    expect(incidentDeliveryStatus("PENDING")).toEqual({ label: "Pending", tone: "neutral" });
    expect(incidentDeliveryCost(delivery)).toBeNull();
    expect(incidentDeliveryCost({ ...delivery, costCents: null } as IncidentDelivery)).toBeNull();
    expect(incidentDeliveryCost({ ...delivery, costCents: 18 } as IncidentDelivery)).toBe(formatEuros(18));
    expect(incidentDeliveryTime(delivery, "UTC")).toBe("19 Aug 2026, 10:00");
    expect(incidentDeliveryTime({ ...delivery, sentAt: "2026-08-19T10:01:00.000Z" }, "UTC")).toBe(
      "19 Aug 2026, 10:01",
    );
  });

  it("keeps the required empty-deliveries copy verbatim", () => {
    expect(emptyDeliveriesCopy).toBe("No notifications were configured when this incident opened.");
  });
});
