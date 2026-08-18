import type {
  EmailMessage,
  EmailSender,
} from "../../domain/email/sender";

export class RecordingEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];

  constructor(private readonly failure: Error | null = null) {}

  async send(
    message: EmailMessage,
  ): Promise<{ providerMessageId: string | null }> {
    this.messages.push({ ...message, to: [...message.to] });
    if (this.failure !== null) throw this.failure;
    return { providerMessageId: `recorded-${this.messages.length}` };
  }
}
