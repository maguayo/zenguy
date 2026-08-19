import type { NotificationMessage } from "../../domain/channels/notifier";

export type SlackFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export class SlackWebhookSender {
  constructor(private readonly fetchFn: SlackFetch = fetch) {}

  async send(webhookUrl: string, message: NotificationMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: message.title,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: message.title },
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: message.lines.join("\n") },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `<${message.link}|Open in Zenguy>`,
                },
              ],
            },
          ],
        }),
      });
    } catch {
      throw new Error("slack error network");
    }
    if (!response.ok) throw new Error(`slack error ${response.status}`);
  }
}
