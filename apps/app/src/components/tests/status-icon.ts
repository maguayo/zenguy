import { statusPresentation } from "@/components/StatusBadge";
import type { Tone } from "@/theme";
import type { FeatherIconName } from "@/ui";

/** One glyph per tone so tiles, rows and timelines read the same way everywhere. */
export function toneIcon(tone: Tone): FeatherIconName {
  switch (tone) {
    case "ok":
      return "check";
    case "danger":
      return "x";
    case "warn":
      return "clock";
    case "info":
      return "play";
    case "accent":
      return "zap";
    default:
      return "tool";
  }
}

export function statusTone(status: string): Tone {
  return statusPresentation(status).tone;
}

export function statusIcon(status: string): FeatherIconName {
  return toneIcon(statusTone(status));
}
