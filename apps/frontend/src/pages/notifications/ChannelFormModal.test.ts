import { describe, expect, it } from "vitest";

import type { Channel } from "../../api/types";
import {
  channelFormDefaults,
  channelFormSchema,
  createChannelInput,
  updateChannelInput,
  type ChannelFormValues,
} from "./ChannelFormModal";

const slack: Channel = {
  configPreview: { webhookUrlMasked: "https://hooks.slack.com/…abcd" },
  createdAt: "2026-08-19T10:00:00.000Z",
  enabled: true,
  id: "channel_1",
  lastDeliveryStatus: null,
  name: "Slack alerts",
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
