import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { MonitorStats } from "@/api/types";
import { formatTime } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";
import { EmptyState, MonoSmall, Small } from "@/ui";

import { formatResponseTime } from "./monitor-display";
import { responseTimeBars } from "./response-time-chart";

const plotHeight = 168;

/**
 * Dependency-free port of the web's response-time area chart: one violet bar
 * per bucket of checks, failed checks in red, tap a bar for the same details
 * the web shows in its tooltip. Drawn on paper with sand gridlines and mono
 * axis labels.
 */
export function ResponseTimeChart({
  series,
  timezone,
}: {
  series: MonitorStats["series"];
  timezone: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const model = useMemo(() => responseTimeBars(series), [series]);
  const first = series[0];
  const last = series[series.length - 1];

  if (model.bars.length === 0 || !first || !last) {
    return <EmptyState style={styles.empty} title="Not enough data yet." />;
  }
  const active = model.bars.find((bar) => bar.key === selected) ?? null;

  return (
    <View accessibilityLabel="Response time chart" style={styles.chart}>
      <View style={styles.plot}>
        <View style={styles.axis}>
          <MonoSmall>{`${model.max} ms`}</MonoSmall>
          <MonoSmall>{`${model.max / 2} ms`}</MonoSmall>
          <MonoSmall>0</MonoSmall>
        </View>
        <View style={styles.area}>
          <View pointerEvents="none" style={[styles.gridLine, styles.gridTop]} />
          <View pointerEvents="none" style={[styles.gridLine, styles.gridMiddle]} />
          <View style={styles.bars}>
            {model.bars.map((bar) => {
              const isActive = bar.key === selected;
              return (
                <Pressable
                  key={bar.key}
                  accessibilityLabel={`${formatTime(bar.t, timezone)}, ${formatResponseTime(bar.responseTimeMs)}, ${bar.failed ? "failed" : "passed"}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  style={styles.slot}
                  onPress={() => setSelected(isActive ? null : bar.key)}
                >
                  <View
                    style={[
                      styles.bar,
                      {
                        backgroundColor: bar.failed ? colors.danger : colors.accent,
                        height: `${Math.max(bar.heightPct, bar.failed ? 4 : 1.5)}%`,
                        opacity: selected === null || isActive ? 1 : 0.35,
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      <View style={styles.xAxis}>
        <MonoSmall>{formatTime(first.t, timezone)}</MonoSmall>
        <MonoSmall>{formatTime(last.t, timezone)}</MonoSmall>
      </View>
      {active ? (
        <View style={styles.tooltip}>
          <View style={[styles.tooltipDot, { backgroundColor: active.failed ? colors.danger : colors.accent }]} />
          <MonoSmall color={colors.textBody}>{formatTime(active.t, timezone)}</MonoSmall>
          <Small color={colors.textBody} style={styles.tooltipText}>
            {formatResponseTime(active.responseTimeMs)} · {active.failed ? "Failed" : "Passed"}
          </Small>
        </View>
      ) : null}
    </View>
  );
}

const axisWidth = 52;

const styles = StyleSheet.create({
  area: { flex: 1, height: plotHeight },
  axis: { alignItems: "flex-end", height: plotHeight, justifyContent: "space-between", width: axisWidth },
  bar: { borderTopLeftRadius: 2, borderTopRightRadius: 2, width: "100%" },
  bars: {
    alignItems: "flex-end",
    borderBottomColor: colors.borderStrong,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 2,
    height: plotHeight,
  },
  chart: { gap: spacing.sm },
  empty: { minHeight: plotHeight },
  gridLine: {
    backgroundColor: colors.borderStrong,
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0,
  },
  gridMiddle: { top: plotHeight / 2 },
  gridTop: { top: 0 },
  plot: { flexDirection: "row", gap: spacing.sm },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  tooltip: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.full,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  tooltipDot: { borderRadius: 3, height: 6, width: 6 },
  tooltipText: { flexShrink: 1 },
  xAxis: { flexDirection: "row", justifyContent: "space-between", paddingLeft: axisWidth + spacing.sm },
});
