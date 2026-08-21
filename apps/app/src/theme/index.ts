import type { TextStyle } from "react-native";

// Same palette as apps/frontend (Tailwind zinc + indigo accent). Status colours
// are reserved for status; indigo is the only accent.
export const colors = {
  accent: "#4f46e5",
  accentDark: "#4338ca",
  accentSoft: "#eef2ff",
  accentSofter: "#e0e7ff",
  bg: "#fafafa",
  border: "#e4e4e7",
  borderStrong: "#d4d4d8",
  danger: "#dc2626",
  dangerDark: "#b91c1c",
  dangerSoft: "#fef2f2",
  info: "#2563eb",
  infoSoft: "#eff6ff",
  ok: "#059669",
  okDark: "#047857",
  okSoft: "#ecfdf5",
  surface: "#ffffff",
  text: "#18181b",
  textMuted: "#71717a",
  textSubtle: "#a1a1aa",
  warn: "#d97706",
  warnSoft: "#fffbeb",
  white: "#ffffff",
  zinc100: "#f4f4f5",
  zinc200: "#e4e4e7",
  zinc300: "#d4d4d8",
  zinc400: "#a1a1aa",
  zinc50: "#fafafa",
  zinc500: "#71717a",
  zinc600: "#52525b",
  zinc700: "#3f3f46",
  zinc800: "#27272a",
  zinc900: "#18181b",
  zinc950: "#09090b",
} as const;

export const spacing = { lg: 16, md: 12, sm: 8, xl: 24, xs: 4, xxl: 32 } as const;

export const radius = { full: 999, lg: 12, md: 8, sm: 6 } as const;

export const controlHeight = { lg: 50, md: 44, sm: 36 } as const;

export const typography = {
  body: { fontSize: 15, lineHeight: 21 },
  caption: { fontSize: 12, lineHeight: 16 },
  heading: { fontSize: 17, fontWeight: "600", lineHeight: 22 },
  label: { fontSize: 13, fontWeight: "500", lineHeight: 18 },
  mono: { fontFamily: "Menlo", fontSize: 13, lineHeight: 18 },
  small: { fontSize: 13, lineHeight: 18 },
  title: { fontSize: 22, fontWeight: "600", letterSpacing: -0.3, lineHeight: 28 },
} as const satisfies Record<string, TextStyle>;

export type Tone = "accent" | "danger" | "info" | "neutral" | "ok" | "warn";

export const toneColors: Record<Tone, { bg: string; border: string; fg: string }> = {
  accent: { bg: colors.accentSoft, border: "#c7d2fe", fg: colors.accentDark },
  danger: { bg: colors.dangerSoft, border: "#fecaca", fg: colors.dangerDark },
  info: { bg: colors.infoSoft, border: "#bfdbfe", fg: colors.info },
  neutral: { bg: colors.zinc100, border: colors.zinc200, fg: colors.zinc700 },
  ok: { bg: colors.okSoft, border: "#a7f3d0", fg: colors.okDark },
  warn: { bg: colors.warnSoft, border: "#fde68a", fg: colors.warn },
};
