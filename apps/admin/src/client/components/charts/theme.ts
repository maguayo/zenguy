import type { ChannelType } from "../../../shared/types";

/**
 * One chart system. Every plot on the panel shares this ink, these margins and
 * these mark specs, so a reader who learns one chart can read all of them.
 *
 * Colour rules, in order of precedence:
 * - status colours (ok / warn / danger / zinc) whenever a series *means* pass,
 *   fail, up or down — never for plain identity;
 * - indigo for the primary measure of a chart that has no verdict to give
 *   (users, tokens, rates);
 * - zinc for the supporting measure, so the subject of the chart stays obvious;
 * - the categorical palette only where identity is the whole point (channels).
 *
 * The status set and the channel set were both validated against a white card
 * surface (worst adjacent CVD ΔE 11.0 and 9.1 respectively, OKLab ×100).
 *
 * SVG fills cannot read a Tailwind utility, so these stay hex literals — but
 * every one of them mirrors a token declared in `styles/index.css` (`--color-
 * accent-400/600/700`, `--color-ok-700`, `--color-danger-600`, `--color-warn-600`
 * and Tailwind's own zinc scale). Change one and change the other.
 */
export const INK = {
  /** zinc-500 — axis ticks and legends. */
  axis: "#71717a",
  /** zinc-200 — horizontal gridlines only. */
  grid: "#e4e4e7",
  /** The card the charts sit on; also the colour of the 2px gap between marks. */
  surface: "#ffffff",
} as const;

export const SERIES = {
  /** accent-600 — the primary metric of a chart with no verdict to give. */
  accent: "#4f46e5",
  /** accent-700 — the larger half of a two-part accent measure. */
  accentDeep: "#4338ca",
  /** indigo-400 (--color-accent-400) — the smaller half of a two-part measure. */
  accentSoft: "#818cf8",
  down: "#dc2626",
  /** zinc-300 — created but not finished: work in flight, not a verdict. */
  inProgress: "#d4d4d8",
  /** danger-600 */
  failed: "#dc2626",
  /** zinc-600 — a supporting measure that carries no verdict. */
  neutral: "#52525b",
  opened: "#dc2626",
  /** ok-700 */
  passed: "#047857",
  resolved: "#047857",
  /** zinc-500 — an infrastructure fault is not a verdict about the test. */
  systemError: "#71717a",
  /** warn-600 */
  timeout: "#d97706",
  up: "#047857",
} as const;

/** Categorical slots 1..7, in the fixed channel order. Identity never follows rank. */
export const CHANNEL_COLOR: Record<ChannelType, string> = {
  CALL: "#4a3aa7",
  DISCORD: "#e87ba4",
  EMAIL: "#2a78d6",
  PUSH: "#1baf7a",
  SLACK: "#eda100",
  SMS: "#eb6834",
  WHATSAPP: "#008300",
};

export const CHANNEL_LABEL: Record<ChannelType, string> = {
  CALL: "Call",
  DISCORD: "Discord",
  EMAIL: "Email",
  PUSH: "Push",
  SLACK: "Slack",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
};

/**
 * A main plot and its companion strip are two charts, not two y-scales: they only
 * line up because they share these margins and this axis width to the pixel.
 */
export const PLOT = {
  barCategoryGap: "18%",
  mainHeight: 176,
  /** mainHeight + railHeight + the 4px `space-y-1` between them. */
  pairHeight: 176 + 92 + 4,
  // The right margin is what keeps the "today" tick from being clipped by the
  // plot edge; the bottom one keeps the zero tick of the main plot on screen.
  margin: { bottom: 6, left: 0, right: 20, top: 8 },
  railHeight: 92,
  singleHeight: 220,
  yWidth: 48,
} as const;

export const AXIS_TICK = {
  fill: INK.axis,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
} as const;

/** Thin marks, capped so a wide range never fills its slot; no animation on polling. */
export const BAR = {
  isAnimationActive: false as const,
  maxBarSize: 24,
};

/** White doing the separating: a 2px surface gap between touching stack segments. */
export const STACK_GAP = {
  stroke: INK.surface,
  strokeWidth: 2,
};

export const LINE = {
  activeDot: { r: 4, stroke: INK.surface, strokeWidth: 2 },
  connectNulls: false as const,
  dot: false as const,
  isAnimationActive: false as const,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 2,
};
