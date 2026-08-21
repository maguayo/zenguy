import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { Channel, Delivery } from "@/api/types";
import { formatEuros } from "@/lib/format";
import {
  channelPriceLabel,
  channelTarget,
  channelTypeLabels,
  lastDeliveryText,
  pausedLabel,
  testDeliveryResult,
} from "./channels";

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
  type: "EMAIL",
  verifiedAt: "2026-08-19T10:01:00.000Z",
};

const delivery: Delivery = {
  attemptCount: 1,
  costCents: null,
  createdAt: "2026-08-19T09:59:00.000Z",
  destinationCountry: null,
  errorSanitized: null,
  eventType: "TEST",
  id: "delivery_1",
  incidentId: null,
  providerMessageId: "message_1",
  sentAt: "2026-08-19T09:59:01.000Z",
  status: "SENT",
};

describe("notification channels list", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-19T10:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("derives safe targets for every config shape", () => {
    expect(channelTarget(baseChannel)).toBe("eng@example.com, oncall@example.com");
    expect(channelTarget({ ...baseChannel, configPreview: {} })).toBe("—");
    expect(
      channelTarget({ ...baseChannel, configPreview: { phoneNumber: "+34612345678" }, type: "SMS" }),
    ).toBe("+34612345678");
    expect(channelTarget({ ...baseChannel, configPreview: {}, type: "CALL" })).toBe("—");
    expect(
      channelTarget({
        ...baseChannel,
        configPreview: { webhookUrlMasked: "https://hooks.slack.com/…abcd" },
        type: "SLACK",
      }),
    ).toBe("https://hooks.slack.com/…abcd");
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
    expect(
      channelPriceLabel({ ...sms, price: { cents: 20, currency: "EUR", destination: "Spain" }, type: "CALL" }),
    ).toBe(`Spain · ${formatEuros(20)} per call`);
    expect(channelPriceLabel(baseChannel)).toBeNull();
    expect(pausedLabel(sms)).toBe("Paused · no credit");
    expect(pausedLabel({ ...sms, paused: { reason: "PAID_OFF" } })).toBe("Paused · SMS & calls off");
    expect(pausedLabel(baseChannel)).toBeNull();
  });

  it("describes the last delivery with a relative time when known", () => {
    expect(lastDeliveryText(null)).toBe("Never used");
    expect(lastDeliveryText("SENT")).toBe("Delivered");
    expect(lastDeliveryText("FAILED")).toBe("Failed");
    expect(lastDeliveryText("SENT", delivery)).toBe("Delivered 1m ago");
    expect(lastDeliveryText("FAILED", delivery)).toBe("Failed 1m ago");
  });

  it("uses the delivery outcome for the exact test toast", () => {
    expect(testDeliveryResult(delivery)).toEqual({ message: "Test sent", tone: "success" });
    expect(
      testDeliveryResult({ ...delivery, errorSanitized: "provider unavailable", status: "FAILED" }),
    ).toEqual({ message: "Test failed: provider unavailable", tone: "error" });
    expect(testDeliveryResult({ ...delivery, errorSanitized: null, status: "PENDING" })).toEqual({
      message: "Test failed: Unknown error",
      tone: "error",
    });
  });

  it("labels every channel type", () => {
    expect(channelTypeLabels).toEqual({
      CALL: "Phone call",
      DISCORD: "Discord",
      EMAIL: "Email",
      SLACK: "Slack",
      SMS: "SMS",
      WHATSAPP: "WhatsApp",
    });
  });
});
