import { logEvent } from "../../shared/log";
import { truncate } from "../../shared/redact";

export type TwilioFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

function responseSid(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("sid" in value)) {
    return null;
  }
  return typeof value.sid === "string" ? value.sid : null;
}

function sanitizeTwilioBody(body: string): string {
  return truncate(
    body
      .replace(/\+[1-9]\d{6,14}/gu, "[redacted-phone]")
      .replace(/%2B[1-9]\d{6,14}/giu, "[redacted-phone]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
      .replace(/https?:\/\/[^\s"']+/giu, "[redacted-url]"),
    100,
  );
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Hard cap so one alert call is always billed as a single minute. */
export const CALL_TIME_LIMIT_SECONDS = 55;

export function speechTwiml(speakText: string): string {
  const say = `<Say voice="alice">${escapeXml(speakText)}</Say>`;
  return `<Response>${say}<Pause length="1"/>${say}</Response>`;
}

export class TwilioApi {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fetchFn: TwilioFetch = fetch,
  ) {}

  private async post(
    resource: "Messages" | "Calls",
    fields: Record<string, string>,
  ): Promise<string | null> {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/${resource}.json`;
    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields).toString(),
      });
    } catch {
      throw new Error("twilio error network");
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logEvent("twilio_error", {
        status: response.status,
        body: sanitizeTwilioBody(body),
      });
      throw new Error(`twilio error ${response.status}`);
    }
    const body: unknown = await response.json().catch(() => null);
    return responseSid(body);
  }

  sendSms(
    to: string,
    from: string,
    body: string,
  ): Promise<string | null> {
    return this.post("Messages", { To: to, From: from, Body: body });
  }

  sendWhatsapp(
    to: string,
    from: string,
    body: string,
  ): Promise<string | null> {
    return this.post("Messages", {
      To: `whatsapp:${to}`,
      From: `whatsapp:${from}`,
      Body: body,
    });
  }

  startCall(
    to: string,
    from: string,
    twiml: string,
    timeLimitSeconds: number = CALL_TIME_LIMIT_SECONDS,
  ): Promise<string | null> {
    return this.post("Calls", {
      To: to,
      From: from,
      Twiml: twiml,
      TimeLimit: String(timeLimitSeconds),
    });
  }
}
