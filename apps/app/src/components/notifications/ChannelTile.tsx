import type { ChannelType } from "@/api/types";
import type { Tone } from "@/theme";
import { IconTile, type FeatherIconName } from "@/ui";

/** One glyph per channel type, in the same Feather set as the rest of the app. */
export const channelFeatherIcons: Record<ChannelType, FeatherIconName> = {
  CALL: "phone",
  DISCORD: "message-circle",
  EMAIL: "mail",
  PUSH: "smartphone",
  SLACK: "hash",
  SMS: "message-square",
  WHATSAPP: "message-circle",
};

export function ChannelTile({
  size = 36,
  tone = "plain",
  type,
}: {
  size?: 28 | 32 | 36 | 44 | 56;
  tone?: Tone | "plain";
  type: ChannelType;
}) {
  return <IconTile icon={channelFeatherIcons[type]} size={size} tone={tone} />;
}
