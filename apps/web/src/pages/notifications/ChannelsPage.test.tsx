import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Channel, Delivery } from "../../api/types";
import {
  ChannelSummary,
  channelTarget,
  lastDeliveryText,
  openChannelPanel,
  testDeliveryResult,
} from "./ChannelsPage";

const baseChannel: Channel = {
  configPreview: { emails: ["eng@example.com", "oncall@example.com"] },
  createdAt: "2026-08-19T10:00:00.000Z",
  enabled: true,
  id: "channel_1",
  lastDeliveryStatus: "SENT",
  name: "Engineering inbox",
  type: "EMAIL",
  verifiedAt: "2026-08-19T10:01:00.000Z",
};

const delivery: Delivery = {
  attemptCount: 1,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
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
  });
});
