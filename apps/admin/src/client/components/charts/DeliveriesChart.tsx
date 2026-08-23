import { memo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import type { DeliveriesDay } from "../../../shared/types";
import { formatNumber } from "../../lib/format";
import { CHANNELS, channelTotals, deliverySeries, formatEuros, sumSeries } from "../../lib/series";
import type { DeliveryPoint } from "../../lib/series";
import { countTick, euroTick } from "./axes";
import {
  ChartCard,
  DayTooltip,
  PlotPair,
  barCursor,
  dayAxisProps,
  gridProps,
  hiddenDayAxisProps,
  lineCursor,
  valueAxisProps,
} from "./parts";
import { BAR, CHANNEL_COLOR, CHANNEL_LABEL, LINE, PLOT, SERIES, STACK_GAP } from "./theme";

function rows(day: DeliveryPoint) {
  return [
    ...CHANNELS.filter((channel) => day[channel] > 0).map((channel) => ({
      color: CHANNEL_COLOR[channel],
      label: CHANNEL_LABEL[channel],
      value: formatNumber(day[channel]),
    })),
    {
      color: SERIES.neutral,
      label: "Cost",
      shape: "line" as const,
      value: formatEuros(day.costCents),
    },
  ];
}

/**
 * Which channel carried each day's alerts, and what it cost. Channel colour is
 * fixed to the channel, so a quiet week never repaints the busy ones.
 *
 * Deliveries and cost are counted differently — every attempt costs money, only
 * a SENT one is a delivery — so a range can cost real euros and deliver nothing.
 * When that happens the columns go and the cost line stays.
 */
export const DeliveriesChart = memo(function DeliveriesChart({
  deliveries,
}: {
  deliveries: DeliveriesDay[];
}) {
  const series = deliverySeries(deliveries);
  const totals = channelTotals(deliveries);
  const sent = totals.reduce((sum, entry) => sum + entry.total, 0);
  const cost = sumSeries(deliveries, "costCents");
  const tooltip = <DayTooltip rows={rows} />;

  return (
    <ChartCard
      aside={sent === 0 ? "No alerts delivered in this range" : `${formatNumber(sent)} sent in this range`}
      empty={sent === 0 && cost === 0 && "No alert activity in this range"}
      emptyHeight={PLOT.pairHeight}
      footer={
        totals.length === 0
          ? undefined
          : totals
              .map((entry) => `${CHANNEL_LABEL[entry.channel]} ${formatNumber(entry.total)}`)
              .join(" · ")
      }
      keys={[
        ...totals.map((entry) => ({
          color: CHANNEL_COLOR[entry.channel],
          label: CHANNEL_LABEL[entry.channel],
        })),
        { color: SERIES.neutral, label: "Cost", shape: "line" as const },
      ]}
      title="Alert deliveries"
    >
      <PlotPair
        label={`Alert deliveries by channel and their cost per day, ${deliveries.length} days`}
        mainEmpty={sent === 0 ? "No alerts were delivered in this range" : undefined}
        main={
          <BarChart barCategoryGap={PLOT.barCategoryGap} data={series} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...hiddenDayAxisProps} />
            <YAxis {...valueAxisProps} {...countTick} />
            <Tooltip content={tooltip} cursor={barCursor} />
            {CHANNELS.map((channel) => (
              <Bar
                {...BAR}
                {...STACK_GAP}
                dataKey={channel}
                fill={CHANNEL_COLOR[channel]}
                key={channel}
                stackId="channel"
              />
            ))}
          </BarChart>
        }
        rail={
          <LineChart data={series} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...dayAxisProps(series.map((day) => day.day))} />
            <YAxis {...valueAxisProps} {...euroTick} />
            <Tooltip content={tooltip} cursor={lineCursor} />
            <Line {...LINE} dataKey="costEuros" stroke={SERIES.neutral} type="monotone" />
          </LineChart>
        }
      />
    </ChartCard>
  );
});
