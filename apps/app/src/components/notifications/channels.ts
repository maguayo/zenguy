import type { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

import type { Channel, ChannelType, Delivery } from "@/api/types";
import { formatEuros, formatRelative } from "@/lib/format";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export const channelTypeLabels: Record<ChannelType, string> = {
  CALL: "Phone call",
  DISCORD: "Discord",
  EMAIL: "Email",
  SLACK: "Slack",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
};

export const channelIcons: Record<ChannelType, IoniconName> = {
  CALL: "call-outline",
  DISCORD: "logo-discord",
  EMAIL: "mail-outline",
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
  }
}

export function channelPriceLabel(channel: Channel): string | null {
  if (!channel.price) return null;
  const unit = channel.type === "CALL" ? "call" : "alert";
  return `${channel.price.destination} · ${formatEuros(channel.price.cents)} per ${unit}`;
}

export function pausedLabel(channel: Channel): string | null {
  if (!channel.paused) return null;
  return channel.paused.reason === "PAID_OFF"
    ? "Paused · SMS & calls off"
    : "Paused · no credit";
}

export function lastDeliveryText(
  status: Channel["lastDeliveryStatus"],
  delivery?: Delivery,
): string {
  if (!status) return "Never used";
  const label = status === "SENT" ? "Delivered" : "Failed";
  return delivery ? `${label} ${formatRelative(delivery.createdAt)}` : label;
}

export function testDeliveryResult(delivery: Delivery): {
  message: string;
  tone: "error" | "success";
} {
  return delivery.status === "SENT"
    ? { message: "Test sent", tone: "success" }
    : {
        message: `Test failed: ${delivery.errorSanitized ?? "Unknown error"}`,
        tone: "error",
      };
}
