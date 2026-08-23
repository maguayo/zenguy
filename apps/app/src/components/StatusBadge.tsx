import { Feather } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import type { Tone } from "@/theme";
import { toneColors } from "@/theme";
import { Badge } from "@/ui";

const statusMap: Record<string, { label: string; pulse?: boolean; tone: Tone }> = {
  CHECKING: { label: "Checking", pulse: true, tone: "info" },
  DOWN: { label: "Down", tone: "danger" },
  FAILED: { label: "Failed", tone: "danger" },
  OPEN: { label: "Open", pulse: true, tone: "danger" },
  PASSED: { label: "Passed", tone: "ok" },
  PENDING: { label: "Pending", tone: "neutral" },
  QUEUED: { label: "Queued", tone: "neutral" },
  RESOLVED: { label: "Resolved", tone: "ok" },
  RUNNING: { label: "Running", pulse: true, tone: "info" },
  SENT: { label: "Sent", tone: "ok" },
  STARTING: { label: "Starting", pulse: true, tone: "info" },
  SYSTEM_ERROR: { label: "System error", tone: "neutral" },
  TIMEOUT: { label: "Timeout", tone: "warn" },
  UNKNOWN: { label: "Unknown", tone: "neutral" },
  UP: { label: "Up", tone: "ok" },
};

export function fallbackLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function statusPresentation(status: string): { label: string; pulse?: boolean; tone: Tone } {
  return statusMap[status] ?? { label: fallbackLabel(status), tone: "neutral" };
}

export interface StatusBadgeProps {
  passedAfterRetry?: boolean;
  size?: "md" | "sm";
  status: string;
}

export function StatusBadge({ passedAfterRetry = false, size = "sm", status }: StatusBadgeProps) {
  const config = statusPresentation(status);
  return (
    <View style={styles.row}>
      <Badge
        dot={status !== "SYSTEM_ERROR"}
        pulse={config.pulse}
        size={size}
        icon={
          status === "SYSTEM_ERROR" ? (
            <Feather color={toneColors.neutral.fg} name="tool" size={11} />
          ) : undefined
        }
        tone={config.tone}
      >
        {config.label}
      </Badge>
      {passedAfterRetry ? (
        <Badge size={size} tone="warn">
          Passed after retry
        </Badge>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
