import type { RunSource } from "@/api/types";
import { Badge } from "@/ui";

const sources: Record<RunSource, { label: string; tone: "accent" | "neutral" }> = {
  MANUAL: { label: "Manual", tone: "accent" },
  SCHEDULED: { label: "Scheduled", tone: "neutral" },
  VALIDATION: { label: "Validation", tone: "neutral" },
};

export function RunSourceBadge({ source }: { source: RunSource }) {
  const presentation = sources[source];
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}
