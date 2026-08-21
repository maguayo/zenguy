import type { NotificationMessage } from "../../domain/channels/notifier";
import { renderBasicEmail } from "../email/templates";
import { RecordingEmailSender } from "../../test/fakes/email";
import { buildChannelSender } from "./index";
import type { TwilioFetch } from "./twilio";

const MESSAGE: NotificationMessage = {
  eventType: "TEST",
  title: "Zenguy test notification",
  lines: ["This is a test.", "No action needed."],
  link: "https://app.zenguy.test/w/ws/notifications",
  speakText: "This is a test notification from Zenguy.",
  shortText: "Zenguy test notification.",
  color: "gray",
};

describe("buildChannelSender", () => {
  it("renders email and dispatches every channel type", async () => {
    const email = new RecordingEmailSender();
    const requests: string[] = [];
    const responses = [
      Response.json({ sid: "SM_sms" }),
      Response.json({ sid: "SM_whatsapp" }),
      Response.json({ sid: "CA_call" }),
      new Response("ok"),
      new Response(null, { status: 204 }),
    ];
    const fetchFn: TwilioFetch = async (url) => {
      requests.push(url);
      const response = responses.shift();
      if (response === undefined) throw new Error("No response");
      return response;
    };
    const sender = buildChannelSender(
      {
        twilio: {
          accountSid: "AC_account",
          authToken: "token",
          fromSms: "+15550000001",
          fromWhatsapp: "+15550000002",
          fromCall: "+15550000003",
        },
      },
      email,
      fetchFn,
    );

    await expect(
      sender.send(
        { type: "EMAIL", config: { emails: ["ops@example.com"] } },
        MESSAGE,
      ),
    ).resolves.toEqual({ providerMessageId: "recorded-1" });
    for (const type of ["SMS", "WHATSAPP", "CALL"] as const) {
      await sender.send(
        {
          type,
          config:
            type === "SMS"
              ? { phoneNumber: "+34600123456", consent: true }
              : { phoneNumber: "+34600123456" },
        },
        MESSAGE,
      );
    }
    await sender.send(
      {
        type: "SLACK",
        config: {
          webhookUrl:
            "https://hooks.slack.com/services/T000/B000/private-token",
        },
      },
      MESSAGE,
    );
    await sender.send(
      {
        type: "DISCORD",
        config: {
          webhookUrl: "https://discord.com/api/webhooks/123/private-token",
        },
      },
      MESSAGE,
    );

    const rendered = renderBasicEmail({
      title: MESSAGE.title,
      bodyLines: MESSAGE.lines,
      ctaLabel: "View in Zenguy",
      ctaUrl: MESSAGE.link,
    });
    expect(email.messages).toEqual([
      {
        to: ["ops@example.com"],
        subject: MESSAGE.title,
        ...rendered,
      },
    ]);
    expect(requests).toEqual([
      "https://api.twilio.com/2010-04-01/Accounts/AC_account/Messages.json",
      "https://api.twilio.com/2010-04-01/Accounts/AC_account/Messages.json",
      "https://api.twilio.com/2010-04-01/Accounts/AC_account/Calls.json",
      "https://hooks.slack.com/services/T000/B000/private-token",
      "https://discord.com/api/webhooks/123/private-token",
    ]);
  });

  it("validates config at the dispatch boundary", async () => {
    const sender = buildChannelSender(
      {
        twilio: {
          accountSid: "AC_account",
          authToken: "token",
          fromSms: "+15550000001",
          fromWhatsapp: "+15550000002",
          fromCall: "+15550000003",
        },
      },
      new RecordingEmailSender(),
    );

    await expect(
      sender.send(
        {
          type: "SMS",
          config: { phoneNumber: "not-e164", consent: true },
        },
        MESSAGE,
      ),
    ).rejects.toThrow();
  });

  it("keeps SMS and voice enabled while WhatsApp is disabled", async () => {
    const requests: string[] = [];
    const bodies: string[] = [];
    const responses = [
      Response.json({ sid: "SM_sms" }),
      Response.json({ sid: "CA_call" }),
    ];
    const sender = buildChannelSender(
      {
        twilio: {
          accountSid: "AC_account",
          authToken: "token",
          fromSms: "+15550000001",
          fromWhatsapp: null,
          fromCall: "+15550000003",
        },
      },
      new RecordingEmailSender(),
      async (url, init) => {
        requests.push(url);
        bodies.push(String(init?.body ?? ""));
        const response = responses.shift();
        if (response === undefined) throw new Error("No response");
        return response;
      },
    );

    await expect(
      sender.send(
        {
          type: "SMS",
          config: { phoneNumber: "+34600123456", consent: true },
        },
        MESSAGE,
      ),
    ).resolves.toEqual({ providerMessageId: "SM_sms" });
    await expect(
      sender.send(
        { type: "CALL", config: { phoneNumber: "+34600123456" } },
        MESSAGE,
      ),
    ).resolves.toEqual({ providerMessageId: "CA_call" });
    await expect(
      sender.send(
        { type: "WHATSAPP", config: { phoneNumber: "+34600123456" } },
        MESSAGE,
      ),
    ).rejects.toThrow("WhatsApp is not configured");

    expect(requests).toEqual([
      "https://api.twilio.com/2010-04-01/Accounts/AC_account/Messages.json",
      "https://api.twilio.com/2010-04-01/Accounts/AC_account/Calls.json",
    ]);
    expect(new URLSearchParams(bodies[0]).get("Body")).toBe(
      "Zenguy test notification. Reply STOP to opt out; HELP for help.",
    );
  });
});
