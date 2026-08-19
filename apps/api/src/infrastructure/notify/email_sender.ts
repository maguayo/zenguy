import type { NotificationMessage } from "../../domain/channels/notifier";
import type { EmailChannelConfig } from "../../domain/channels/types";
import type { EmailSender } from "../../domain/email/sender";
import { renderBasicEmail } from "../email/templates";

export class EmailNotificationSender {
  constructor(private readonly email: EmailSender) {}

  async send(
    config: EmailChannelConfig,
    message: NotificationMessage,
  ): Promise<{ providerMessageId: string | null }> {
    const rendered = renderBasicEmail({
      title: message.title,
      bodyLines: message.lines,
      ctaLabel: "View in Zenguy",
      ctaUrl: message.link,
    });
    return this.email.send({
      to: [...config.emails],
      subject: message.title,
      ...rendered,
    });
  }
}
