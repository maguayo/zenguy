import type { ChannelType } from "./types";

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
    channel: { type: ChannelType; config: unknown },
    message: NotificationMessage,
  ): Promise<{ providerMessageId: string | null }>;
}
