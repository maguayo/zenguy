import { describe, expect, it } from "@jest/globals";

import type { Channel } from "@/api/types";
import { ApiError } from "@/lib/api";
import {
  channelConfigFromValues,
  channelFormDefaults,
  channelFormErrors,
  channelFormField,
  channelFormSchema,
  channelTypeOptions,
  createChannelInput,
  isPaidChannelType,
  isPhoneChannelType,
  isWebhookChannelType,
  phoneHint,
  updateChannelInput,
  webhookHint,
  type ChannelFormValues,
} from "./channel-form";

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
  it("labels paid, phone and webhook types", () => {
    expect(isPaidChannelType("SMS")).toBe(true);
    expect(isPaidChannelType("CALL")).toBe(true);
    expect(isPaidChannelType("WHATSAPP")).toBe(true);
    expect(isPaidChannelType("EMAIL")).toBe(false);
    expect(isPaidChannelType(null)).toBe(false);
    expect(isPhoneChannelType("CALL")).toBe(true);
    expect(isWebhookChannelType("DISCORD")).toBe(true);
    expect(isWebhookChannelType("SMS")).toBe(false);
    expect(channelTypeOptions.map((option) => option.type)).toEqual([
      "EMAIL",
      "SMS",
      "WHATSAPP",
      "CALL",
      "SLACK",
      "DISCORD",
    ]);
    expect(channelTypeOptions.filter((option) => option.paid).map((option) => option.label)).toEqual([
      "SMS",
      "WhatsApp",
      "Phone call",
    ]);
  });

  it("keeps the field hints from the web form", () => {
    expect(phoneHint("WHATSAPP")).toContain("must have WhatsApp");
    expect(phoneHint("SMS")).toBe("E.164 format, with country code.");
    expect(webhookHint("SLACK")).toContain("Slack workspace");
    expect(webhookHint("DISCORD")).toContain("Discord server");
  });

  it("validates each channel config like the backend", () => {
    const createSchema = channelFormSchema(false);
    expect(
      createSchema.safeParse({ ...values, emails: [], type: "EMAIL", webhookUrl: "" }).success,
    ).toBe(false);
    expect(
      createSchema.safeParse({ ...values, emails: ["ops@example.com"], type: "EMAIL", webhookUrl: "" })
        .success,
    ).toBe(true);
    expect(createSchema.safeParse({ ...values, name: "  ", webhookUrl: "" }).success).toBe(false);
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
        phoneNumber: "+34612345678",
        smsConsent: true,
        type: "SMS",
      }).success,
    ).toBe(true);
    expect(
      createSchema.safeParse({ ...values, phoneNumber: "+34612345678", type: "WHATSAPP" }).success,
    ).toBe(false);
    expect(
      createSchema.safeParse({
        ...values,
        phoneNumber: "+34612345678",
        smsConsent: true,
        type: "WHATSAPP",
      }).success,
    ).toBe(true);
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
        smsConsent: true,
        type: "CALL",
      }),
    ).toMatchObject({
      config: { consent: true, phoneNumber: "+34612345678" },
      type: "CALL",
    });
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
    expect(() =>
      channelConfigFromValues({ ...values, phoneNumber: "+34612345678", type: "SMS" }),
    ).toThrow("Recipient consent is required");
  });

  it("never reads back or resends a masked webhook during an ordinary edit", () => {
    expect(channelFormDefaults(slack)).toMatchObject({
      name: "Slack alerts",
      type: "SLACK",
      webhookUrl: "",
    });
    expect(channelFormDefaults()).toEqual({
      emails: [],
      name: "",
      phoneNumber: "",
      smsConsent: false,
      type: "EMAIL",
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

  it("maps API validation details onto form fields", () => {
    expect(channelFormField("name")).toBe("name");
    expect(channelFormField("config.emails.0")).toBe("emails");
    expect(channelFormField("config.phoneNumber")).toBe("phoneNumber");
    expect(channelFormField("config.consent")).toBe("smsConsent");
    expect(channelFormField("config.webhookUrl")).toBe("webhookUrl");
    expect(channelFormField("type")).toBeNull();
    expect(channelFormField("")).toBeNull();
  });

  it("shows a rejected paid type as the form-level error", () => {
    const rejected = new ApiError("Invalid request", {
      code: "VALIDATION_ERROR",
      details: [{ field: "type", message: "Turn on SMS & calls to add this channel." }],
      status: 400,
    });
    expect(channelFormErrors(rejected)).toEqual({
      fields: {},
      root: "Turn on SMS & calls to add this channel.",
    });

    const fieldErrors = new ApiError("Invalid request", {
      code: "VALIDATION_ERROR",
      details: [
        { field: "config.phoneNumber", message: "Invalid phone number" },
        { field: "config.phoneNumber", message: "Second message is ignored" },
        { field: "name", message: "Name taken" },
      ],
      status: 400,
    });
    expect(channelFormErrors(fieldErrors)).toEqual({
      fields: { name: "Name taken", phoneNumber: "Invalid phone number" },
      root: null,
    });

    const noDetails = new ApiError("Invalid request", { code: "VALIDATION_ERROR", status: 400 });
    expect(channelFormErrors(noDetails)).toEqual({ fields: {}, root: "Invalid request" });
    expect(channelFormErrors(new Error("Network down"))).toEqual({ fields: {}, root: "Network down" });
    expect(channelFormErrors(undefined)).toEqual({ fields: {}, root: "Something went wrong" });
  });
});
