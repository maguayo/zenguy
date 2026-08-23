import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from "react-native";

import { colors, fonts, typography } from "@/theme";

type Variant = keyof typeof typography;

interface Props extends TextProps {
  color?: string;
  variant?: Variant;
}

const weightToFace: Record<string, string> = {
  "500": fonts.sans.medium,
  "600": fonts.sans.semibold,
  "700": fonts.sans.bold,
  "800": fonts.sans.bold,
  "900": fonts.sans.bold,
  bold: fonts.sans.bold,
  medium: fonts.sans.medium,
  semibold: fonts.sans.semibold,
};

const monoFaces = new Set<string>([fonts.mono.regular, fonts.mono.medium]);

/**
 * Custom fonts on iOS are selected by face, not by `fontWeight`; this keeps
 * `fontWeight: "500" | "600" | "700"` working by swapping in the matching
 * Geist face (mono text keeps its own faces).
 */
export function resolveTextStyle(style: TextStyle): TextStyle {
  const { fontWeight, ...rest } = style;
  if (fontWeight === undefined) return style;
  const family = rest.fontFamily ?? fonts.sans.regular;
  if (monoFaces.has(family)) {
    const face = String(fontWeight) === "400" || fontWeight === "normal" ? fonts.mono.regular : fonts.mono.medium;
    return { ...rest, fontFamily: face };
  }
  const face = weightToFace[String(fontWeight)] ?? fonts.sans.regular;
  return { ...rest, fontFamily: face };
}

export function Text({ color, style, variant = "body", ...props }: Props) {
  const flat = StyleSheet.flatten([styles.base, typography[variant], color ? { color } : null, style]) ?? {};
  return <RNText {...props} style={resolveTextStyle(flat)} />;
}

export const Display = (props: Omit<Props, "variant">) => <Text variant="display" {...props} />;
export const Title = (props: Omit<Props, "variant">) => <Text variant="title" {...props} />;
export const Heading = (props: Omit<Props, "variant">) => <Text variant="heading" {...props} />;
export const Body = (props: Omit<Props, "variant">) => <Text variant="body" {...props} />;
export const Small = (props: Omit<Props, "variant">) => <Text variant="small" {...props} />;
export const Muted = (props: Omit<Props, "variant">) => (
  <Text color={colors.textMuted} variant="small" {...props} />
);
export const Caption = (props: Omit<Props, "variant">) => (
  <Text color={colors.textMuted} variant="caption" {...props} />
);
export const Label = (props: Omit<Props, "variant">) => <Text variant="label" {...props} />;
export const Mono = (props: Omit<Props, "variant">) => <Text variant="mono" {...props} />;
export const MonoSmall = (props: Omit<Props, "variant">) => (
  <Text color={colors.textMuted} variant="monoSmall" {...props} />
);
/** Mono, uppercase section label — introduces every section instead of bold card titles. */
export const Eyebrow = (props: Omit<Props, "variant">) => (
  <Text color={colors.textMuted} variant="eyebrow" {...props} />
);

const styles = StyleSheet.create({
  base: { color: colors.text },
});
