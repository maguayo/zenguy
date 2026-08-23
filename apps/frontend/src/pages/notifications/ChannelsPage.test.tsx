import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Channel, Delivery } from "../../api/types";
import { formatEuros } from "../../lib/format";
import {
  ChannelSummary,
  canChangeChannelDefault,
  channelPriceLabel,
  channelTarget,
  closeChannelPanel,
  lastDeliveryText,
  openChannelPanel,
  pausedLabel,
  reachLabel,
  testDeliveryResult,
} from "./ChannelsPage";

const baseChannel: Channel = {
  configPreview: { emails: ["eng@example.com", "oncall@example.com"] },
  createdAt: "2026-08-19T10:00:00.000Z",
  enabled: true,
  id: "channel_1",
  isDefault: true,
  lastDeliveryStatus: "SENT",
  name: "Engineering inbox",
  paused: null,
  price: null,
  reach: null,
  type: "EMAIL",
  verifiedAt: "2026-08-19T10:01:00.000Z",
};

const delivery: Delivery = {
  attemptCount: 1,
  costCents: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  destinationCountry: null,
  errorSanitized: null,
  eventType: "TEST",
  id: "delivery_1",
  incidentId: null,
  providerMessageId: "message_1",
  sentAt: new Date(Date.now() - 59_000).toISOString(),
  status: "SENT",
};

describe("notification channels list", () => {
  it("renders identity, target, verified status, and last delivery text", () => {
    const html = renderToStaticMarkup(
      <ChannelSummary channel={baseChannel} lastDelivery={delivery} />,
    );
    expect(html).toContain("Engineering inbox");
    expect(html).toContain("eng@example.com, oncall@example.com");
    expect(html).toContain("Verified");
    expect(html).toContain("Delivered 1m ago");
    expect(html).toContain("Default");
  });

  it("shows the destination price and pause state of paid channels", () => {
    const sms: Channel = {
      ...baseChannel,
      configPreview: { phoneNumber: "+34612345678" },
      isDefault: false,
      paused: { reason: "NO_CREDIT" },
      price: { cents: 18, currency: "EUR", destination: "Spain" },
      type: "SMS",
    };
    expect(channelPriceLabel(sms)).toBe(`Spain · ${formatEuros(18)} per alert`);
    expect(channelPriceLabel({ ...sms, type: "CALL", price: { ...sms.price!, cents: 20 } })).toBe(
      `Spain · ${formatEuros(20)} per call`,
    );
    expect(channelPriceLabel(baseChannel)).toBeNull();
    expect(pausedLabel(sms)).toBe("Paused · no credit");
    expect(pausedLabel({ ...sms, paused: { reason: "PAID_OFF" } })).toBe(
      "Paused · SMS & calls off",
    );
    expect(pausedLabel(baseChannel)).toBeNull();
    const html = renderToStaticMarkup(<ChannelSummary channel={sms} />);
    expect(html).toContain("per alert");
    expect(html).toContain("0,18");
    expect(html).toContain("Paused · no credit");
    expect(html).not.toContain("Default");
  });

  it("derives safe targets for every config shape", () => {
    expect(channelTarget(baseChannel)).toBe("eng@example.com, oncall@example.com");
    expect(
      channelTarget({
        ...baseChannel,
        configPreview: { phoneNumber: "+34612345678" },
        type: "SMS",
      }),
    ).toBe("+34612345678");
    expect(
      channelTarget({
        ...baseChannel,
        configPreview: { webhookUrlMasked: "https://hooks.slack.com/…abcd" },
        type: "SLACK",
      }),
    ).toBe("https://hooks.slack.com/…abcd");
  });

  it("renders disabled, failed, and never-used states with text", () => {
    const failed = renderToStaticMarkup(
      <ChannelSummary
        channel={{
          ...baseChannel,
          enabled: false,
          lastDeliveryStatus: "FAILED",
          verifiedAt: null,
        }}
      />,
    );
    expect(failed).toContain("Disabled");
    expect(failed).toContain("Failed");
    expect(lastDeliveryText(null)).toBe("Never used");
    expect(lastDeliveryText("AMBIGUOUS")).toBe("Needs reconciliation");
  });

  it("describes mobile push channels by reach", () => {
    const push: Channel = {
      ...baseChannel,
      configPreview: { recipients: "WORKSPACE_MEMBERS" },
      reach: { devices: 3, members: 2 },
      type: "PUSH",
    };
    expect(channelTarget(push)).toBe("Everyone in this workspace who uses the Zenguy app");
    expect(reachLabel(push)).toBe("3 devices · 2 members · free");
    expect(reachLabel({ ...push, reach: { devices: 1, members: 1 } })).toBe(
      "1 device · 1 member · free",
    );
    expect(reachLabel({ ...push, reach: { devices: 0, members: 0 } })).toBe(
      "No devices yet · install the app and allow notifications",
    );
    expect(reachLabel(baseChannel)).toBeNull();
    const html = renderToStaticMarkup(<ChannelSummary channel={push} />);
    expect(html).toContain("Mobile push");
    expect(html).toContain("3 devices · 2 members · free");
    expect(canChangeChannelDefault(push)).toBe(false);
    expect(canChangeChannelDefault(baseChannel)).toBe(true);
  });

  it("uses the delivery outcome for the exact test toast", () => {
    expect(testDeliveryResult(delivery)).toEqual({
      message: "Test sent",
      tone: "success",
    });
    expect(
      testDeliveryResult({
        ...delivery,
        errorSanitized: "provider unavailable",
        status: "FAILED",
      }),
    ).toEqual({
      message: "Test failed: provider unavailable",
      tone: "error",
    });
    expect(
      testDeliveryResult({
        ...delivery,
        errorSanitized: "provider acknowledgement lost",
        status: "AMBIGUOUS",
      }),
    ).toEqual({
      message:
        "Test outcome needs reconciliation: provider acknowledgement lost",
      tone: "error",
    });
  });

  it("opens only one shareable channel panel at a time", () => {
    const editor = openChannelPanel(
      new URLSearchParams("deliveries=old&filter=active"),
      "channel",
      "new",
    );
    expect(editor.get("channel")).toBe("new");
    expect(editor.has("deliveries")).toBe(false);
    expect(editor.get("filter")).toBe("active");

    const history = openChannelPanel(editor, "deliveries", "channel_1");
    expect(history.get("deliveries")).toBe("channel_1");
    expect(history.has("channel")).toBe(false);
    expect(closeChannelPanel(history, "deliveries").toString()).toBe("filter=active");
  });
});
