import type {
  EmailMessage,
  EmailSender,
} from "../../domain/email/sender";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

function providerMessageId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    return null;
  }
  return typeof value.id === "string" ? value.id : null;
}

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async send(
    message: EmailMessage,
  ): Promise<{ providerMessageId: string | null }> {
    let response: Response;
    try {
      response = await this.fetchFn(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
    } catch {
      throw new Error("email provider error");
    }

    if (!response.ok) {
      throw new Error(`email provider error: ${response.status}`);
    }

    const body: unknown = await response.json().catch(() => null);
    return { providerMessageId: providerMessageId(body) };
  }
}
