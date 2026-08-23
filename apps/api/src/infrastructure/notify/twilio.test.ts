import type { NotificationMessage } from "../../domain/channels/notifier";
import { speechTwiml, TwilioApi, type TwilioFetch } from "./twilio";

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

class RecordingFetch {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly responses: Response[]) {}

  readonly fetch: TwilioFetch = async (url, init) => {
    this.requests.push({ url, init });
    const response = this.responses.shift();
    if (response === undefined) throw new Error("No recorded response");
    return response;
  };
}

function fields(request: RecordedRequest): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(request.init?.body)));
}

const MESSAGE: NotificationMessage = {
  eventType: "FAILURE",
  title: "Failure",
  lines: ["One", "Two"],
  link: "https://app.zenguy.test/w/ws/incidents/inc",
  speakText: 'Checkout <Prod> & "API" isn\'t healthy.',
  shortText: "Zenguy: FAILED Checkout.",
  color: "red",
};

describe("TwilioApi", () => {
  it("sends exact SMS, WhatsApp, and Call requests", async () => {
    const recorder = new RecordingFetch([
      Response.json({ sid: "SM_sms" }),
      Response.json({ sid: "SM_whatsapp" }),
      Response.json({ sid: "CA_call" }),
    ]);
    const twilio = new TwilioApi("AC_account", "auth-token", recorder.fetch);

    await expect(
      twilio.sendSms("+34600123456", "+15550000001", MESSAGE.shortText),
    ).resolves.toBe("SM_sms");
    await expect(
      twilio.sendWhatsapp(
        "+34600123456",
        "+15550000002",
        MESSAGE.shortText,
      ),
    ).resolves.toBe("SM_whatsapp");
    await expect(
      twilio.startCall(
        "+34600123456",
        "+15550000003",
        speechTwiml(MESSAGE.speakText),
      ),
    ).resolves.toBe("CA_call");

    const [sms, whatsapp, call] = recorder.requests;
    expect(sms?.url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC_account/Messages.json",
    );
    expect(fields(sms as RecordedRequest)).toEqual({
      To: "+34600123456",
      From: "+15550000001",
      Body: MESSAGE.shortText,
    });
    expect(whatsapp?.url).toBe(sms?.url);
    expect(fields(whatsapp as RecordedRequest)).toEqual({
      To: "whatsapp:+34600123456",
      From: "whatsapp:+15550000002",
      Body: MESSAGE.shortText,
    });
    expect(call?.url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC_account/Calls.json",
    );
    expect(fields(call as RecordedRequest)).toEqual({
      To: "+34600123456",
      From: "+15550000003",
      Twiml:
        '<Response><Say voice="alice">Checkout &lt;Prod&gt; &amp; &quot;API&quot; isn&apos;t healthy.</Say><Pause length="1"/><Say voice="alice">Checkout &lt;Prod&gt; &amp; &quot;API&quot; isn&apos;t healthy.</Say></Response>',
      TimeLimit: "55",
    });

    for (const request of recorder.requests) {
      expect(request.init?.method).toBe("POST");
      expect(request.init?.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(request.init?.headers);
      expect(headers.get("Authorization")).toBe(
        `Basic ${btoa("AC_account:auth-token")}`,
      );
      expect(headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded",
      );
    }
  });

  it("throws and logs a bounded sanitized provider error", async () => {
    const recorder = new RecordingFetch([
      new Response(
        JSON.stringify({
          message:
            "To +34600123456 failed via https://hooks.example.test/private-webhook-token",
        }),
        { status: 500 },
      ),
    ]);
    const twilio = new TwilioApi("AC_account", "auth-token", recorder.fetch);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      twilio.sendSms("+34600123456", "+15550000001", "private body"),
    ).rejects.toThrow("twilio error 500");

    const output = String(log.mock.calls[0]?.[0]);
    expect(output).toContain('"event":"twilio_error"');
    expect(output).toContain("[redacted-phone]");
    expect(output).toContain("[redacted-url]");
    expect(output).not.toContain("+34600123456");
    expect(output).not.toContain("private-webhook-token");
    expect(output.length).toBeLessThan(240);
    log.mockRestore();
  });
});
