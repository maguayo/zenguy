import type { NotificationMessage } from "../../domain/channels/notifier";
import {
  providerAmbiguous,
  providerRejected,
} from "../../domain/channels/notifier";
import type { PushDeviceRepo } from "../../domain/push/repo";
import { redactPushTokens } from "../../domain/push/types";
import type { Clock } from "../../shared/clock";
import { logEvent } from "../../shared/log";
import { truncate } from "../../shared/redact";
import { PUSH_DEVICE_INACTIVITY_TTL_DAYS } from "../../shared/constants";
import {
  externalProviderSignal,
  readLimitedJsonResponse,
  readLimitedResponseText,
} from "../../shared/limited_response";

export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_BATCH_SIZE = 100;
const MAX_EXPO_RESPONSE_BYTES = 512 * 1_024;
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
  /** Coalesces retries on supported Android transports. */
  collapseId?: string;
  /** Replaces an already displayed duplicate on Android. */
  tag?: string;
  /** Groups the same logical delivery on iOS. */
  threadId?: string;
}

export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Keeps the verified HTTPS Universal Link carried by the notification. */
export function pushDeepLink(link: string, appUrl: string): string {
  const base = appUrl.replace(/\/+$/u, "");
  try {
    const baseUrl = new URL(base);
    const target = new URL(link);
    if (
      baseUrl.protocol !== "https:" ||
      target.origin !== baseUrl.origin ||
      target.username !== "" ||
      target.password !== ""
    ) {
      return base;
    }
    // Push providers, lock-screen previews and notification taps must never
    // receive a query/fragment capability even if a future caller supplies one.
    return `${baseUrl.origin}${target.pathname}`;
  } catch {
    return base;
  }
}

export function buildPushMessages(
  tokens: string[],
  message: NotificationMessage,
  context: { workspaceId: string; appUrl: string },
  idempotencyKey?: string,
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
    ...(idempotencyKey === undefined
      ? {}
      : {
          collapseId: idempotencyKey,
          tag: idempotencyKey,
          threadId: idempotencyKey,
        }),
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
          signal: externalProviderSignal(),
        });
      } catch (error) {
        throw providerAmbiguous("expo push error network", { cause: error });
      }
      if (!response.ok) {
        const body = await readLimitedResponseText(
          response,
          MAX_EXPO_RESPONSE_BYTES,
        ).catch(() => "");
        logEvent("expo_push_error", {
          status: response.status,
          body: sanitizeExpoError(body),
        });
        const message = `expo push error ${response.status}`;
        if (response.status >= 500 || [408, 425, 429].includes(response.status)) {
          throw providerAmbiguous(message);
        }
        throw providerRejected(message);
      }
      const payload = (await readLimitedJsonResponse(
        response,
        MAX_EXPO_RESPONSE_BYTES,
      ).catch(() => null)) as {
        data?: ExpoPushTicket[];
      } | null;
      const batchTickets = payload?.data;
      if (!Array.isArray(batchTickets) || batchTickets.length !== batch.length) {
        throw providerAmbiguous("expo push error invalid response");
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
    idempotencyKey = `push:${workspaceId}`,
  ): Promise<{ providerMessageId: string | null }> {
    const recipients = await this.devices.listEnabledTokensForWorkspace(
      workspaceId,
      this.clock.now() - PUSH_DEVICE_INACTIVITY_TTL_DAYS * 24 * 60 * 60 * 1_000,
    );
    if (recipients.length === 0) {
      throw providerRejected("No mobile devices are registered for this workspace");
    }
    const tokens = recipients.map((recipient) => recipient.token);
    const tickets = await this.client.send(
      buildPushMessages(
        tokens,
        message,
        { workspaceId, appUrl: this.appUrl },
        idempotencyKey,
      ),
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
      throw providerRejected(`expo push rejected: ${sanitizeExpoError(reason)}`);
    }
    return { providerMessageId: accepted[0]?.id ?? null };
  }
}
