import { StyleSheet, View } from "react-native";

import type { Usage } from "@/api/types";
import { formatDateTime, formatEuros } from "@/lib/format";
import { colors, spacing } from "@/theme";
import { Body, Caption, Divider, Muted } from "@/ui";

export type UsageTone = "accent" | "danger" | "warn";

export function usageTone(usage: Usage): UsageTone {
  if (usage.overageRuns > 0) return "danger";
  if (usage.billableRuns / usage.includedRuns >= 0.8) return "warn";
  return "accent";
}

export function usagePercentage(usage: Usage): number {
  return Math.min(100, Math.max(0, (usage.billableRuns / usage.includedRuns) * 100));
}

const barTone: Record<UsageTone, string> = {
  accent: colors.accent,
  danger: colors.danger,
  warn: colors.warn,
};

function UsageRow({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.row}>
      <Muted>{label}</Muted>
      <Body style={styles.rowValue}>{value}</Body>
    </View>
  );
}

export function UsageMeter({
  showProjection = true,
  timezone,
  usage,
}: {
  showProjection?: boolean;
  timezone: string;
  usage: Usage;
}) {
  const tone = usageTone(usage);
  const percentage = usagePercentage(usage);
  const label = `${usage.billableRuns} of ${usage.includedRuns} runs used`;
  return (
    <View>
      <Body style={styles.rowValue}>{label}</Body>
      <View
        accessibilityLabel={label}
        accessibilityRole="progressbar"
        accessibilityValue={{ max: usage.includedRuns, min: 0, now: usage.billableRuns }}
        style={styles.track}
      >
        <View style={[styles.fill, { backgroundColor: barTone[tone], width: `${percentage}%` }]} />
      </View>
      <View style={styles.rows}>
        <UsageRow label="Included runs" value={usage.includedRuns} />
        <UsageRow label="Used" value={usage.billableRuns} />
        <UsageRow label="Remaining" value={usage.remainingRuns} />
        {usage.overageRuns > 0 ? (
          <>
            <UsageRow label="Extra runs" value={usage.overageRuns} />
            <UsageRow label="Extra cost" value={formatEuros(usage.overageAmountCents)} />
          </>
        ) : null}
      </View>
      {showProjection ? (
        <>
          <Divider />
          <Caption>
            Projected total {formatEuros(usage.projectedTotalCents)} · resets{" "}
            {formatDateTime(usage.periodEnd, timezone)}
          </Caption>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { borderRadius: 4, height: "100%" },
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  rowValue: { fontWeight: "500" },
  rows: { gap: spacing.sm, marginTop: spacing.lg },
  track: { backgroundColor: colors.zinc100, borderRadius: 4, height: 8, marginTop: spacing.sm, overflow: "hidden" },
});
