import {
  channelConfigSchema,
  configPreview,
  type ChannelType,
} from "./types";

describe("channel config schemas", () => {
  it("validates email recipients and limits the list to ten", () => {
    expect(
      channelConfigSchema("EMAIL").parse({
        emails: ["alerts@example.com", "ops@example.com"],
      }),
    ).toEqual({ emails: ["alerts@example.com", "ops@example.com"] });
    expect(
      channelConfigSchema("EMAIL").safeParse({ emails: [] }).success,
    ).toBe(false);
    expect(
      channelConfigSchema("EMAIL").safeParse({ emails: ["not-email"] })
        .success,
    ).toBe(false);
    expect(
      channelConfigSchema("EMAIL").safeParse({
        emails: Array.from({ length: 11 }, (_, index) => `a${index}@example.com`),
      }).success,
    ).toBe(false);
  });

  it.each(["WHATSAPP", "CALL"] as const)(
    "validates %s E.164 phone numbers",
    (type) => {
      expect(
        channelConfigSchema(type).safeParse({ phoneNumber: "+34600123456" })
          .success,
      ).toBe(true);
      for (const phoneNumber of [
        "34600123456",
        "+01234567",
        "+123456",
        "+1234567890123456",
        "+34 600 123 456",
      ]) {
        expect(
          channelConfigSchema(type).safeParse({ phoneNumber }).success,
        ).toBe(false);
      }
    },
  );

  it("requires explicit consent for SMS", () => {
    expect(
      channelConfigSchema("SMS").safeParse({
        phoneNumber: "+34600123456",
        consent: true,
      }).success,
    ).toBe(true);
    expect(
      channelConfigSchema("SMS").safeParse({ phoneNumber: "+34600123456" })
        .success,
    ).toBe(false);
  });

  it("accepts only provider-owned Slack and Discord webhook URLs", () => {
    expect(
      channelConfigSchema("SLACK").safeParse({
        webhookUrl: "https://hooks.slack.com/services/T000/B000/SECRET",
      }).success,
    ).toBe(true);
    expect(
      channelConfigSchema("SLACK").safeParse({
        webhookUrl: "https://hooks.slack.com.evil.test/services/SECRET",
      }).success,
    ).toBe(false);
    for (const webhookUrl of [
      "https://discord.com/api/webhooks/123/secret",
      "https://discordapp.com/api/webhooks/123/secret",
    ]) {
      expect(
        channelConfigSchema("DISCORD").safeParse({ webhookUrl }).success,
      ).toBe(true);
    }
    expect(
      channelConfigSchema("DISCORD").safeParse({
        webhookUrl: "https://example.com/api/webhooks/123/secret",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields so config cannot hide unvalidated credentials", () => {
    expect(
      channelConfigSchema("SMS").safeParse({
        phoneNumber: "+34600123456",
        consent: true,
        token: "must-not-pass",
      }).success,
    ).toBe(false);
  });
});

describe("configPreview", () => {
  it.each([
    ["EMAIL", { emails: ["alerts@example.com"] }, { emails: ["alerts@example.com"] }],
    [
      "SMS",
      { phoneNumber: "+34600123456", consent: true },
      { phoneNumber: "+34600123456" },
    ],
    ["WHATSAPP", { phoneNumber: "+34600123456" }, { phoneNumber: "+34600123456" }],
    ["CALL", { phoneNumber: "+34600123456" }, { phoneNumber: "+34600123456" }],
  ] as const)("previews %s config", (type, config, expected) => {
    expect(configPreview(type, config)).toEqual(expected);
  });

  it.each([
    [
      "SLACK",
      "https://hooks.slack.com/services/T000/B000/super-secret-abcd",
      "https://hooks.slack.com/…abcd",
    ],
    [
      "DISCORD",
      "https://discord.com/api/webhooks/123/super-secret-wxyz",
      "https://discord.com/api/webhooks/…wxyz",
    ],
  ] as const)("masks %s webhook URLs", (type, webhookUrl, expected) => {
    const preview = configPreview(type as ChannelType, { webhookUrl });
    const serialized = JSON.stringify(preview);

    expect(preview).toEqual({ webhookUrlMasked: expected });
    expect(serialized).not.toContain(webhookUrl);
    expect(serialized).not.toContain("super-secret");
  });
});
