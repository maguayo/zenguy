import { formatNumber } from "../../lib/format";
import { formatEuros, formatPct, formatTokens } from "../../lib/series";

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

export const tokenTick = {
  allowDecimals: false as const,
  tickFormatter: (value: number) => formatTokens(value),
};

export const secondsTick = {
  tickFormatter: (value: number) => `${value}s`,
};

export const millisTick = {
  allowDecimals: false as const,
  tickFormatter: (value: number) => `${formatNumber(value)}ms`,
};

export const euroTick = {
  tickFormatter: (value: number) => formatEuros(Math.round(value * 100)),
};

/** Re-exported so every axis, tooltip and footer prints a rate the same way. */
export const ratio = formatPct;
