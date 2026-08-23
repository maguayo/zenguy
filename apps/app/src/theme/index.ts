import type { TextStyle, ViewStyle } from "react-native";

// "Paper & Pulse" — the marketing site's identity brought to iOS
// (docs/superpowers/specs/2026-08-23-ios-app-redesign-design.md).
// Paper canvas, ink type, one violet accent; status colours are reserved for
// status and violet also means "in motion" (running, checking). No blue.
export const palette = {
  amber: "#B26A14",
  amberBg: "#FBF0E0",
  amberLine: "#EFD3A6",
  body: "#4A453E",
  dusk: "#7C766B",
  faint: "#B5AC9D",
  green: "#46A758",
  greenBg: "#E7F3EA",
  greenDeep: "#2F7F3F",
  greenLine: "#B9DFC2",
  ink: "#13110D",
  inkCard: "#2A2722",
  inkDeep: "#0C0B09",
  line: "#E8E2D6",
  muted: "#877F71",
  paper: "#F2EEE6",
  paperDeep: "#EAE4D9",
  parch: "#C9C2B3",
  red: "#E5484D",
  redBg: "#FCEBEC",
  redDeep: "#C1363B",
  redLine: "#F5BDBF",
  sand: "#D8D1C2",
  stone: "#6B655B",
  surface: "#FAF8F4",
  violet: "#625ED7",
  violetBg: "#EEEDFB",
  violetDeep: "#4F4BC4",
  violetInk: "#2D2B7E",
  violetLine: "#CFCDF4",
  violetSoft: "#A9A3F0",
  white: "#FFFFFF",
} as const;

/**
 * Semantic colours. The `zinc*` names are kept so older screens keep working
 * while they migrate; they now resolve to the warm neutral scale.
 */
export const colors = {
  accent: palette.violet,
  accentDark: palette.violetDeep,
  accentInk: palette.violetInk,
  accentSoft: palette.violetBg,
  accentSofter: "#E2E0F8",
  bg: palette.paper,
  border: palette.line,
  borderStrong: palette.sand,
  danger: palette.red,
  dangerDark: palette.redDeep,
  dangerSoft: palette.redBg,
  info: palette.violet,
  infoSoft: palette.violetBg,
  ink: palette.ink,
  inkCard: palette.inkCard,
  ok: palette.green,
  okDark: palette.greenDeep,
  okSoft: palette.greenBg,
  onInk: palette.surface,
  onInkMuted: palette.parch,
  onInkSubtle: palette.dusk,
  surface: palette.surface,
  surfaceSunken: palette.paperDeep,
  text: palette.ink,
  textBody: palette.body,
  textMuted: palette.muted,
  textStrong: palette.ink,
  textSubtle: palette.faint,
  warn: palette.amber,
  warnSoft: palette.amberBg,
  white: palette.white,
  zinc100: "#EFEAE1",
  zinc200: palette.line,
  zinc300: palette.sand,
  zinc400: palette.faint,
  zinc50: "#F7F4EE",
  zinc500: palette.muted,
  zinc600: palette.stone,
  zinc700: palette.body,
  zinc800: palette.inkCard,
  zinc900: palette.ink,
  zinc950: palette.inkDeep,
} as const;

/** Geist (reads) and Geist Mono (measures), embedded through the expo-font plugin. */
export const fonts = {
  mono: { medium: "GeistMono-Medium", regular: "GeistMono-Regular" },
  sans: {
    bold: "Geist-Bold",
    medium: "Geist-Medium",
    regular: "Geist-Regular",
    semibold: "Geist-SemiBold",
  },
} as const;

export const spacing = { lg: 16, md: 12, sm: 8, xl: 24, xs: 4, xxl: 32, xxxl: 48 } as const;

/** Screen gutter (horizontal padding of every screen). */
export const gutter = 20;

export const radius = { full: 999, lg: 14, md: 10, sm: 7, xl: 20 } as const;

export const controlHeight = { lg: 52, md: 46, sm: 36 } as const;

export const typography = {
  body: { fontFamily: fonts.sans.regular, fontSize: 16, lineHeight: 22 },
  caption: { fontFamily: fonts.sans.medium, fontSize: 12, lineHeight: 16 },
  display: { fontFamily: fonts.sans.bold, fontSize: 34, letterSpacing: -0.8, lineHeight: 40 },
  eyebrow: {
    fontFamily: fonts.mono.medium,
    fontSize: 11,
    letterSpacing: 0.9,
    lineHeight: 14,
    textTransform: "uppercase",
  },
  heading: { fontFamily: fonts.sans.semibold, fontSize: 17, letterSpacing: -0.2, lineHeight: 22 },
  label: { fontFamily: fonts.sans.medium, fontSize: 14, lineHeight: 19 },
  mono: { fontFamily: fonts.mono.regular, fontSize: 13, lineHeight: 18 },
  monoSmall: { fontFamily: fonts.mono.regular, fontSize: 11, lineHeight: 14 },
  small: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 19 },
  title: { fontFamily: fonts.sans.semibold, fontSize: 24, letterSpacing: -0.4, lineHeight: 30 },
} as const satisfies Record<string, TextStyle>;

/** Soft ink shadows from the marketing site (card-shadow-sm / card-shadow). */
export const shadows = {
  card: {
    shadowColor: palette.ink,
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
  },
  hero: {
    shadowColor: palette.ink,
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
  },
} as const satisfies Record<string, ViewStyle>;

export type Tone = "accent" | "danger" | "info" | "neutral" | "ok" | "warn";

export const toneColors: Record<Tone, { bg: string; border: string; fg: string }> = {
  accent: { bg: palette.violetBg, border: palette.violetLine, fg: palette.violetInk },
  danger: { bg: palette.redBg, border: palette.redLine, fg: palette.redDeep },
  info: { bg: palette.violetBg, border: palette.violetLine, fg: palette.violetDeep },
  neutral: { bg: colors.zinc100, border: palette.sand, fg: palette.body },
  ok: { bg: palette.greenBg, border: palette.greenLine, fg: palette.greenDeep },
  warn: { bg: palette.amberBg, border: palette.amberLine, fg: palette.amber },
};

/** Solid colour used for dots, strips and ticks of a tone. */
export const toneSolid: Record<Tone, string> = {
  accent: palette.violet,
  danger: palette.red,
  info: palette.violet,
  neutral: palette.sand,
  ok: palette.green,
  warn: palette.amber,
};
