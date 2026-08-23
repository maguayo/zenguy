import { describe, expect, it } from "vitest";

import { formatEuros } from "../../lib/format";

import type { Channel } from "../../api/types";
import {
  channelFormDefaults,
  channelFormSchema,
  createChannelInput,
  isPaidChannelType,
  quoteHint,
  updateChannelInput,
  type ChannelFormValues,
} from "./ChannelFormModal";

const slack: Channel = {
  configPreview: { webhookUrlMasked: "https://hooks.slack.com/…abcd" },
  createdAt: "2026-08-19T10:00:00.000Z",
  enabled: true,
  id: "channel_1",
  isDefault: false,
  lastDeliveryStatus: null,
  name: "Slack alerts",
  paused: null,
  price: null,
  reach: null,
  type: "SLACK",
  verifiedAt: null,
};

const values: ChannelFormValues = {
  emails: [],
  name: " Slack alerts ",
  phoneNumber: "",
  smsConsent: false,
  type: "SLACK",
  webhookUrl: "https://hooks.slack.com/services/T/B/secret",
};

describe("channel form", () => {
  it("labels paid types and turns quotes into price hints", () => {
    expect(isPaidChannelType("SMS")).toBe(true);
    expect(isPaidChannelType("CALL")).toBe(true);
    expect(isPaidChannelType("EMAIL")).toBe(false);
    const quote = {
      callCents: 20,
      currency: "EUR" as const,
      destination: { iso: "ES", name: "Spain", region: "EUROPE" as const },
      smsCents: 18,
    };
    expect(quoteHint("SMS", quote)).toBe(
      `Spain · ${formatEuros(18)} per SMS, charged from alert credit`,
    );
    expect(quoteHint("CALL", quote)).toBe(
      `Spain · ${formatEuros(20)} per call, charged from alert credit`,
    );
    expect(quoteHint("EMAIL", quote)).toBeNull();
    expect(quoteHint("SMS", undefined)).toBeNull();
  });

  it("validates each channel config like the backend", () => {
    const createSchema = channelFormSchema(false);
    expect(
      createSchema.safeParse({ ...values, emails: [], type: "EMAIL", webhookUrl: "" }).success,
    ).toBe(false);
    expect(
      createSchema.safeParse({ ...values, phoneNumber: "612345678", type: "SMS" }).success,
    ).toBe(false);
    expect(
      createSchema.safeParse({
        ...values,
        phoneNumber: "+34612345678",
        smsConsent: false,
        type: "SMS",
      }).success,
    ).toBe(false);
    expect(
      createSchema.safeParse({
        ...values,
        type: "DISCORD",
        webhookUrl: "https://example.com/not-discord",
      }).success,
    ).toBe(false);
    expect(createSchema.safeParse(values).success).toBe(true);
  });

  it("builds a fixed config for mobile push channels", () => {
    expect(createChannelInput({ ...values, name: "Phones", type: "PUSH" })).toEqual({
      config: { recipients: "WORKSPACE_MEMBERS" },
      isDefault: true,
      name: "Phones",
      type: "PUSH",
    });
    expect(channelFormSchema(false).safeParse({ ...values, type: "PUSH" }).success).toBe(true);
  });

  it("builds create config for email and phone channel types", () => {
    expect(
      createChannelInput({
        ...values,
        emails: ["alerts@example.com"],
        name: " Inbox ",
        type: "EMAIL",
      }),
    ).toEqual({
      config: { emails: ["alerts@example.com"] },
      name: "Inbox",
      type: "EMAIL",
    });
    expect(
      createChannelInput({
        ...values,
        name: "Phone",
        phoneNumber: " +34612345678 ",
        type: "CALL",
      }),
    ).toMatchObject({ config: { phoneNumber: "+34612345678" }, type: "CALL" });
    expect(
      createChannelInput({
        ...values,
        name: "SMS",
        phoneNumber: " +34612345678 ",
        smsConsent: true,
        type: "SMS",
      }),
    ).toMatchObject({
      config: { consent: true, phoneNumber: "+34612345678" },
      type: "SMS",
    });
  });

  it("never reads back or resends a masked webhook during an ordinary edit", () => {
    expect(channelFormDefaults(slack)).toMatchObject({
      name: "Slack alerts",
      type: "SLACK",
      webhookUrl: "",
    });
    expect(updateChannelInput({ ...values, webhookUrl: "" })).toEqual({
      name: "Slack alerts",
    });
    expect(updateChannelInput(values)).toEqual({
      config: { webhookUrl: "https://hooks.slack.com/services/T/B/secret" },
      name: "Slack alerts",
    });
    expect(channelFormSchema(true).safeParse({ ...values, webhookUrl: "" }).success).toBe(true);
  });
});
