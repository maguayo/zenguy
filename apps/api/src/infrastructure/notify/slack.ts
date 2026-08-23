import type { NotificationMessage } from "../../domain/channels/notifier";
import {
  providerAmbiguous,
  providerRejected,
} from "../../domain/channels/notifier";
import {
  cancelResponseBody,
  externalProviderSignal,
} from "../../shared/limited_response";

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
        signal: externalProviderSignal(),
      });
    } catch (error) {
      throw providerAmbiguous("slack error network", { cause: error });
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      const message = `slack error ${response.status}`;
      if (response.status >= 500 || [408, 425, 429].includes(response.status)) {
        throw providerAmbiguous(message);
      }
      throw providerRejected(message);
    }
    await cancelResponseBody(response);
  }
}
