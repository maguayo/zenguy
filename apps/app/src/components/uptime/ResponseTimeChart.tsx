import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { MonitorStats } from "@/api/types";
import { formatTime } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";
import { Caption, EmptyState, Small } from "@/ui";

import { formatResponseTime } from "./monitor-display";
import { responseTimeBars } from "./response-time-chart";

const plotHeight = 180;

/**
 * Dependency-free port of the web's response-time area chart: one bar per
 * bucket of checks, failed checks in the danger colour, tap a bar for the
 * same details the web shows in its tooltip.
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
          <Caption>{`${model.max} ms`}</Caption>
          <Caption>0</Caption>
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
                        height: `${Math.max(bar.heightPct, bar.failed ? 4 : 1)}%`,
                        opacity: selected === null || isActive ? 1 : 0.45,
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
        <Caption>{formatTime(first.t, timezone)}</Caption>
        <Caption>{formatTime(last.t, timezone)}</Caption>
      </View>
      {active ? (
        <View style={styles.tooltip}>
          <Small style={styles.tooltipTime}>{formatTime(active.t, timezone)}</Small>
          <Small color={colors.zinc600}>
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
  axis: { height: plotHeight, justifyContent: "space-between", width: axisWidth },
  bar: { borderTopLeftRadius: 2, borderTopRightRadius: 2, width: "100%" },
  bars: {
    alignItems: "flex-end",
    borderBottomColor: colors.zinc300,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 1,
    height: plotHeight,
  },
  chart: { gap: spacing.sm },
  empty: { minHeight: plotHeight },
  gridLine: {
    backgroundColor: colors.zinc100,
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
    backgroundColor: colors.zinc50,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tooltipTime: { fontWeight: "500" },
  xAxis: { flexDirection: "row", justifyContent: "space-between", paddingLeft: axisWidth + spacing.sm },
});
