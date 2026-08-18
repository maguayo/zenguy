import type {
  EmailMessage,
  EmailSender,
} from "../../domain/email/sender";
import { logEvent } from "../../shared/log";

export class DevEmailSender implements EmailSender {
  async send(
    message: EmailMessage,
  ): Promise<{ providerMessageId: string | null }> {
    logEvent("dev_email", {
      to: message.to.join(","),
      subject: message.subject,
      textFirst200: message.text.slice(0, 200),
    });
    return { providerMessageId: null };
  }
}
