import type { RunSource } from "../api/types";
import { Badge } from "./ui/Badge";

const sources: Record<RunSource, { label: string; tone: "neutral" | "info" }> = {
  VALIDATION: { label: "Validation", tone: "neutral" },
  MANUAL: { label: "Manual", tone: "info" },
  SCHEDULED: { label: "Scheduled", tone: "neutral" },
};

export function RunSourceBadge({ source }: { source: RunSource }) {
  const presentation = sources[source];
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}
