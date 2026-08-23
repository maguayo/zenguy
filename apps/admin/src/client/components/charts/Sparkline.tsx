import { memo } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

import { sparkDomain } from "../../lib/series";
import type { SparkPoint } from "../../lib/series";
import { SERIES } from "./theme";

/**
 * The shape of the last fortnight under a stat tile: no axes, no ticks, no
 * tooltip — the tile's own value and hint carry every number this implies.
 */
export const Sparkline = memo(function Sparkline({ points }: { points: SparkPoint[] }) {
  return (
    <ResponsiveContainer height={40} width="100%">
      <AreaChart data={points} margin={{ bottom: 3, left: 0, right: 0, top: 4 }}>
        {/* The shape is the point, not the level: a fortnight of a five figure
            total would otherwise be a flat line pinned to the top of the band.
            A fortnight that never moved has no shape at all, and `sparkDomain`
            drops it to the floor so it cannot be mistaken for activity. */}
        <YAxis domain={sparkDomain(points)} hide />
        <Area
          dataKey="value"
          dot={false}
          fill={SERIES.accent}
          fillOpacity={0.1}
          isAnimationActive={false}
          stroke={SERIES.accent}
          strokeWidth={2}
          type="monotone"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
});
