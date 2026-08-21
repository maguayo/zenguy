import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, controlHeight, radius, spacing } from "@/theme";
import { Text } from "./Text";

export type ButtonVariant = "danger" | "ghost" | "primary" | "secondary";

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
  danger: { bg: colors.danger, border: colors.danger, fg: colors.white, pressed: colors.dangerDark },
  ghost: { bg: "transparent", border: "transparent", fg: colors.accentDark, pressed: colors.zinc100 },
  primary: { bg: colors.accent, border: colors.accent, fg: colors.white, pressed: colors.accentDark },
  secondary: { bg: colors.surface, border: colors.zinc300, fg: colors.zinc800, pressed: colors.zinc100 },
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
  const palette = variantStyles[variant];
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
        { backgroundColor: pressed ? palette.pressed : palette.bg, borderColor: palette.border, height: controlHeight[size] },
        size === "sm" && styles.compact,
        fullWidth && styles.fullWidth,
        inactive && styles.inactive,
        style,
      ]}
      testID={testID}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <>
          {icon}
          <Text
            color={palette.fg}
            style={[styles.label, size === "lg" && styles.labelLg]}
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
    paddingHorizontal: spacing.lg,
  },
  compact: { paddingHorizontal: spacing.md },
  fullWidth: { alignSelf: "stretch" },
  inactive: { opacity: 0.55 },
  label: { fontSize: 15 },
  labelLg: { fontSize: 16 },
});
