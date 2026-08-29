import { formatNumber } from "../../lib/format";
import { pct } from "../../lib/series";

/** Count axes never invent halves of a run. */
export const countTick = {
  allowDecimals: false as const,
  tickFormatter: (value: number) => formatNumber(value),
};

export const percentTick = {
  domain: [0, 100] as [number, number],
  tickFormatter: (value: number) => `${value}%`,
  ticks: [0, 50, 100],
};

export const millisTick = {
  allowDecimals: false as const,
  tickFormatter: (value: number) => `${formatNumber(value)}ms`,
};

/** Re-exported so every axis, tooltip and footer prints a rate the same way. */
export const ratio = pct;
