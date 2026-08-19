import type {
  EmailMessage,
  EmailSender,
} from "../../domain/email/sender";

function senderAddress(value: string): string | EmailAddress {
  const trimmed = value.trim();
  const named = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/u.exec(trimmed);
  if (named === null) return trimmed;

  return {
    name: named[1]?.trim() ?? "",
    email: named[2] ?? "",
  };
}

export class CloudflareEmailSender implements EmailSender {
  constructor(
    private readonly binding: SendEmail,
    private readonly from: string,
  ) {}

  async send(
    message: EmailMessage,
  ): Promise<{ providerMessageId: string | null }> {
    try {
      const result = await this.binding.send({
        to: message.to,
        from: senderAddress(this.from),
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      return { providerMessageId: result.messageId };
    } catch {
      throw new Error("email provider error");
    }
  }
}
