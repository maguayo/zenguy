import { StyleSheet, View } from "react-native";

import type { Usage } from "@/api/types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { colors, radius, spacing, toneSolid } from "@/theme";
import { Caption, Divider, Mono, Muted, Text } from "@/ui";

export type UsageTone = "accent" | "danger" | "warn";

export function usageTone(usage: Usage): UsageTone {
  if (usage.overageRuns > 0) return "danger";
  if (usage.billableRuns / usage.includedRuns >= 0.8) return "warn";
  return "accent";
}

export function usagePercentage(usage: Usage): number {
  return Math.min(100, Math.max(0, (usage.billableRuns / usage.includedRuns) * 100));
}

function UsageRow({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.row}>
      <Muted>{label}</Muted>
      <Mono>{value}</Mono>
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
      <View style={styles.headline}>
        <Text style={styles.big}>{usage.billableRuns}</Text>
        <Muted style={styles.of}>of {usage.includedRuns} runs this cycle</Muted>
      </View>
      <View
        accessibilityLabel={label}
        accessibilityRole="progressbar"
        accessibilityValue={{ max: usage.includedRuns, min: 0, now: usage.billableRuns }}
        style={styles.track}
      >
        <View style={[styles.fill, { backgroundColor: toneSolid[tone], width: `${percentage}%` }]} />
      </View>
      <View style={styles.rows}>
        <UsageRow label="Included runs" value={usage.includedRuns} />
        <UsageRow label="Used" value={usage.billableRuns} />
        <UsageRow label="Remaining" value={usage.remainingRuns} />
        {usage.overageRuns > 0 ? (
          <>
            <UsageRow label="Extra runs" value={usage.overageRuns} />
            <UsageRow
              label="Extra cost"
              value={formatCurrency(usage.overageAmountCents, usage.currency)}
            />
          </>
        ) : null}
      </View>
      {showProjection ? (
        <>
          <Divider />
          <Caption>
            Projected total {formatCurrency(usage.projectedTotalCents, usage.currency)} · resets{" "}
            {formatDateTime(usage.periodEnd, timezone)}
          </Caption>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 26, fontWeight: "600", letterSpacing: -0.6, lineHeight: 32 },
  fill: { borderRadius: radius.sm, height: "100%" },
  headline: { alignItems: "baseline", flexDirection: "row", gap: spacing.sm },
  of: { flexShrink: 1 },
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  rows: { gap: spacing.sm, marginTop: spacing.lg },
  track: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.sm,
    height: 8,
    marginTop: spacing.md,
    overflow: "hidden",
  },
});
