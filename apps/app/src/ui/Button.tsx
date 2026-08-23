import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { colors, controlHeight, palette, radius, spacing } from "@/theme";
import { Text } from "./Text";

export type ButtonVariant = "accent" | "danger" | "ghost" | "primary" | "secondary";

interface Props {
  accessibilityLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  onPress?: () => void;
  size?: "lg" | "md" | "sm";
  style?: StyleProp<ViewStyle>;
  testID?: string;
  title: string;
  variant?: ButtonVariant;
}

const variantStyles: Record<ButtonVariant, { bg: string; border: string; fg: string; pressed: string }> = {
  // Ink is the default strong action; violet is for the one call-to-action
  // that matters most on a screen (sign in, create, run).
  accent: { bg: palette.violet, border: palette.violet, fg: palette.white, pressed: palette.violetDeep },
  danger: { bg: palette.red, border: palette.red, fg: palette.white, pressed: palette.redDeep },
  ghost: { bg: "transparent", border: "transparent", fg: palette.violetDeep, pressed: palette.violetBg },
  primary: { bg: palette.ink, border: palette.ink, fg: palette.surface, pressed: palette.inkCard },
  secondary: { bg: colors.surface, border: colors.borderStrong, fg: palette.ink, pressed: colors.zinc100 },
};

export function Button({
  accessibilityLabel,
  disabled = false,
  fullWidth = false,
  icon,
  loading = false,
  onPress,
  size = "md",
  style,
  testID,
  title,
  variant = "secondary",
}: Props) {
  const tone = variantStyles[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: inactive }}
      disabled={inactive}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed ? tone.pressed : tone.bg,
          borderColor: pressed ? tone.pressed : tone.border,
          height: controlHeight[size],
        },
        size === "sm" && styles.compact,
        fullWidth && styles.fullWidth,
        inactive && styles.inactive,
        pressed && styles.pressed,
        style,
      ]}
      testID={testID}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color={tone.fg} size="small" />
      ) : (
        <>
          {icon}
          <Text
            color={tone.fg}
            style={[styles.label, size === "lg" && styles.labelLg, size === "sm" && styles.labelSm]}
            variant="label"
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  compact: { borderRadius: radius.sm + 1, paddingHorizontal: spacing.md },
  fullWidth: { alignSelf: "stretch" },
  inactive: { opacity: 0.5 },
  label: { fontSize: 16, lineHeight: 20 },
  labelLg: { fontSize: 17 },
  labelSm: { fontSize: 14 },
  pressed: { transform: [{ scale: 0.985 }] },
});
