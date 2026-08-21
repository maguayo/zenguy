import { Text as RNText, StyleSheet, type TextProps } from "react-native";

import { colors, typography } from "@/theme";

type Variant = keyof typeof typography;

interface Props extends TextProps {
  color?: string;
  variant?: Variant;
}

export function Text({ color, style, variant = "body", ...props }: Props) {
  return (
    <RNText
      {...props}
      style={[styles.base, typography[variant], color ? { color } : null, style]}
    />
  );
}

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

const styles = StyleSheet.create({
  base: { color: colors.text },
});
