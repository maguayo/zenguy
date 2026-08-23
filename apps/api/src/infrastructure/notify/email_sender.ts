import type { NotificationMessage } from "../../domain/channels/notifier";
import type { EmailChannelConfig } from "../../domain/channels/types";
import type { EmailSender } from "../../domain/email/sender";
import { providerAmbiguous } from "../../domain/channels/notifier";
import { renderBasicEmail } from "../email/templates";

export class EmailNotificationSender {
  constructor(private readonly email: EmailSender) {}

  async send(
    config: EmailChannelConfig,
    message: NotificationMessage,
    idempotencyKey: string,
  ): Promise<{ providerMessageId: string | null }> {
    const rendered = renderBasicEmail({
      title: message.title,
      bodyLines: message.lines,
      ctaLabel: "View in Zenguy",
      ctaUrl: message.link,
    });
    try {
      return await this.email.send({
        to: [...config.emails],
        subject: message.title,
        ...rendered,
        // Cloudflare exposes this custom header in provider-side logs. It is
        // not claimed as native deduplication, but gives support a stable
        // delivery key when reconciling an accepted message.
        headers: { "X-ZenGuy-Delivery-ID": idempotencyKey },
      });
    } catch (error) {
      throw providerAmbiguous("email provider outcome ambiguous", { cause: error });
    }
  }
}
