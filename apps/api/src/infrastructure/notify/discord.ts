import type { NotificationMessage } from "../../domain/channels/notifier";
import {
  providerAmbiguous,
  providerRejected,
} from "../../domain/channels/notifier";
import {
  cancelResponseBody,
  externalProviderSignal,
  readLimitedJsonResponse,
} from "../../shared/limited_response";

const MAX_DISCORD_RESPONSE_BYTES = 64 * 1_024;

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

  async send(
    webhookUrl: string,
    message: NotificationMessage,
  ): Promise<string> {
    let response: Response;
    try {
      const url = new URL(webhookUrl);
      // Discord returns the created message when `wait=true`, giving us a
      // provider id that can be correlated during incident reconciliation.
      url.searchParams.set("wait", "true");
      response = await this.fetchFn(url.href, {
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
        signal: externalProviderSignal(),
      });
    } catch (error) {
      throw providerAmbiguous("discord error network", { cause: error });
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      const message = `discord error ${response.status}`;
      if (response.status >= 500 || [408, 425, 429].includes(response.status)) {
        throw providerAmbiguous(message);
      }
      throw providerRejected(message);
    }
    const payload = (await readLimitedJsonResponse(
      response,
      MAX_DISCORD_RESPONSE_BYTES,
    ).catch(() => null)) as {
      id?: unknown;
    } | null;
    if (typeof payload?.id !== "string" || payload.id.length === 0) {
      throw providerAmbiguous("discord outcome missing provider id");
    }
    return payload.id;
  }
}
