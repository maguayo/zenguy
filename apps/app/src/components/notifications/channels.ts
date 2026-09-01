import type { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

import type { Channel, ChannelType, Delivery } from "@/api/types";
import { formatRelative } from "@/lib/format";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export const channelTypeLabels: Record<ChannelType, string> = {
  CALL: "Phone call",
  DISCORD: "Discord",
  EMAIL: "Email",
  PUSH: "Mobile push",
  SLACK: "Slack",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
};

export const channelIcons: Record<ChannelType, IoniconName> = {
  CALL: "call-outline",
  DISCORD: "logo-discord",
  EMAIL: "mail-outline",
  PUSH: "phone-portrait-outline",
  SLACK: "logo-slack",
  SMS: "chatbox-ellipses-outline",
  WHATSAPP: "logo-whatsapp",
};

export function channelTarget(channel: Channel): string {
  switch (channel.type) {
    case "EMAIL":
      return channel.configPreview.emails?.join(", ") || "—";
    case "SMS":
    case "WHATSAPP":
    case "CALL":
      return channel.configPreview.phoneNumber ?? "—";
    case "SLACK":
    case "DISCORD":
      return channel.configPreview.webhookUrlMasked ?? "—";
    case "PUSH":
      return "All workspace members with the Zenguy app";
  }
}

/** "3 devices · 2 members" for push channels, null otherwise. */
export function channelReachLabel(channel: Channel): string | null {
  if (channel.type !== "PUSH" || !channel.reach) return null;
  const { devices, members } = channel.reach;
  return `${devices} ${devices === 1 ? "device" : "devices"} · ${members} ${members === 1 ? "member" : "members"}`;
}

export function pausedLabel(channel: Channel): string | null {
  if (!channel.paused) return null;
  return "Temporarily unavailable";
}

export function lastDeliveryText(
  status: Channel["lastDeliveryStatus"],
  delivery?: Delivery,
): string {
  if (!status) return "Never used";
  const label =
    status === "SENT"
      ? "Delivered"
      : status === "AMBIGUOUS"
        ? "Needs reconciliation"
        : "Failed";
  return delivery ? `${label} ${formatRelative(delivery.createdAt)}` : label;
}

export function testDeliveryResult(delivery: Delivery): {
  message: string;
  tone: "error" | "success";
} {
  return delivery.status === "SENT"
    ? { message: "Test sent", tone: "success" }
    : delivery.status === "AMBIGUOUS"
      ? {
          message: `Test outcome needs reconciliation: ${delivery.errorSanitized ?? "Provider outcome is unknown"}`,
          tone: "error",
        }
    : {
        message: `Test failed: ${delivery.errorSanitized ?? "Unknown error"}`,
        tone: "error",
      };
}
