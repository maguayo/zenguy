import type { NotificationMessage } from "../../domain/channels/notifier";

export type DiscordFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const COLOR_VALUES: Record<NotificationMessage["color"], number> = {
  red: 0xdc2626,
  green: 0x16a34a,
  gray: 0x6b7280,
};

export class DiscordWebhookSender {
  constructor(private readonly fetchFn: DiscordFetch = fetch) {}

  async send(webhookUrl: string, message: NotificationMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [
            {
              title: message.title,
              description: message.lines.join("\n"),
              url: message.link,
              color: COLOR_VALUES[message.color],
            },
          ],
        }),
      });
    } catch {
      throw new Error("discord error network");
    }
    if (!response.ok) throw new Error(`discord error ${response.status}`);
  }
}
