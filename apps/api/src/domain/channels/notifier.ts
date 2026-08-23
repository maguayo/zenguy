import type { ChannelType } from "./types";

export type NotificationProviderOutcome = "REJECTED" | "AMBIGUOUS";

/**
 * Provider adapters must distinguish an explicit rejection from an outcome
 * that may have been accepted before the connection/response failed. Unknown
 * errors are treated as ambiguous by the application layer.
 */
export class NotificationProviderError extends Error {
  constructor(
    message: string,
    readonly outcome: NotificationProviderOutcome,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NotificationProviderError";
  }
}

export function providerRejected(
  message: string,
  options?: ErrorOptions,
): NotificationProviderError {
  return new NotificationProviderError(message, "REJECTED", options);
}

export function providerAmbiguous(
  message: string,
  options?: ErrorOptions,
): NotificationProviderError {
  return new NotificationProviderError(message, "AMBIGUOUS", options);
}

export interface NotificationMessage {
  eventType: "FAILURE" | "RECOVERY" | "TEST";
  title: string;
  lines: string[];
  link: string;
  speakText: string;
  shortText: string;
  color: "red" | "green" | "gray";
}

export interface ChannelSender {
  send(
    channel: { type: ChannelType; config: unknown; workspaceId?: string },
    message: NotificationMessage,
    context: {
      /** Stable across every attempt for this one logical delivery. */
      deliveryId: string;
      idempotencyKey: string;
      attemptCount: number;
    },
  ): Promise<{ providerMessageId: string | null }>;
}
