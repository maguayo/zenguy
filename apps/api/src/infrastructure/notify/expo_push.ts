import type { NotificationMessage } from "../../domain/channels/notifier";
import type { PushDeviceRepo } from "../../domain/push/repo";
import { redactPushTokens } from "../../domain/push/types";
import type { Clock } from "../../shared/clock";
import { logEvent } from "../../shared/log";
import { truncate } from "../../shared/redact";

export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_BATCH_SIZE = 100;
/** Expo's ticket error that means the token must never be used again. */
export const DEVICE_NOT_REGISTERED = "DeviceNotRegistered";

export type ExpoFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: "default";
  priority: "high";
}

export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Turns the web link of a notification into the app's deep link. */
export function pushDeepLink(link: string, appUrl: string): string {
  const base = appUrl.replace(/\/+$/u, "");
  if (link.startsWith(`${base}/`)) return `zenguy://${link.slice(base.length + 1)}`;
  return link;
}

export function buildPushMessages(
  tokens: string[],
  message: NotificationMessage,
  context: { workspaceId: string; appUrl: string },
): ExpoPushMessage[] {
  const incidentMatch = /\/incidents\/([^/?#]+)/u.exec(message.link);
  const data: Record<string, string> = {
    url: pushDeepLink(message.link, context.appUrl),
    workspaceId: context.workspaceId,
    eventType: message.eventType,
    ...(incidentMatch?.[1] === undefined ? {} : { incidentId: incidentMatch[1] }),
  };
  const body = truncate(message.lines[0] ?? message.shortText, 180);
  return tokens.map((to) => ({
    to,
    title: truncate(message.title, 100),
    body,
    data,
    sound: "default",
    priority: "high",
  }));
}

function sanitizeExpoError(text: string): string {
  return truncate(
    redactPushTokens(text).replace(/https?:\/\/[^\s"']+/giu, "[redacted-url]"),
    200,
  );
}

export class ExpoPushClient {
  constructor(
    private readonly fetchFn: ExpoFetch = fetch,
    private readonly accessToken: string | null = null,
  ) {}

  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const tickets: ExpoPushTicket[] = [];
    for (let start = 0; start < messages.length; start += EXPO_PUSH_BATCH_SIZE) {
      const batch = messages.slice(start, start + EXPO_PUSH_BATCH_SIZE);
      let response: Response;
      try {
        response = await this.fetchFn(EXPO_PUSH_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(this.accessToken === null
              ? {}
              : { Authorization: `Bearer ${this.accessToken}` }),
          },
          body: JSON.stringify(batch),
        });
      } catch {
        throw new Error("expo push error network");
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        logEvent("expo_push_error", {
          status: response.status,
          body: sanitizeExpoError(body),
        });
        throw new Error(`expo push error ${response.status}`);
      }
      const payload = (await response.json().catch(() => null)) as {
        data?: ExpoPushTicket[];
      } | null;
      const batchTickets = payload?.data;
      if (!Array.isArray(batchTickets) || batchTickets.length !== batch.length) {
        throw new Error("expo push error invalid response");
      }
      tickets.push(...batchTickets);
    }
    return tickets;
  }
}

/**
 * Delivers one notification to every enabled device of the workspace's
 * members and retires tokens Expo reports as no longer registered.
 */
export class ExpoPushSender {
  constructor(
    private readonly client: ExpoPushClient,
    private readonly devices: Pick<
      PushDeviceRepo,
      "listEnabledTokensForWorkspace" | "disableTokens"
    >,
    private readonly appUrl: string,
    private readonly clock: Clock,
  ) {}

  async send(
    workspaceId: string,
    message: NotificationMessage,
  ): Promise<{ providerMessageId: string | null }> {
    const recipients = await this.devices.listEnabledTokensForWorkspace(workspaceId);
    if (recipients.length === 0) {
      throw new Error("No mobile devices are registered for this workspace");
    }
    const tokens = recipients.map((recipient) => recipient.token);
    const tickets = await this.client.send(
      buildPushMessages(tokens, message, { workspaceId, appUrl: this.appUrl }),
    );
    const unregistered = tokens.filter(
      (_token, index) => tickets[index]?.details?.error === DEVICE_NOT_REGISTERED,
    );
    if (unregistered.length > 0) {
      await this.devices.disableTokens(
        unregistered,
        DEVICE_NOT_REGISTERED,
        this.clock.now(),
      );
      logEvent("push_devices_unregistered", {
        workspaceId,
        count: unregistered.length,
      });
    }
    const accepted = tickets.filter((ticket) => ticket.status === "ok");
    if (accepted.length === 0) {
      const reason = tickets[0]?.details?.error ?? tickets[0]?.message ?? "rejected";
      throw new Error(`expo push rejected: ${sanitizeExpoError(reason)}`);
    }
    return { providerMessageId: accepted[0]?.id ?? null };
  }
}
