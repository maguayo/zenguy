import type { ReactNode } from "react";
import { ActivityIndicator, Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";

import { colors, radius, spacing } from "@/theme";
import { Button } from "./Button";
import { useBreathing } from "./motion";
import { Body, Heading, Muted } from "./Text";

export function EmptyState({
  action,
  description,
  icon,
  style,
  title,
}: {
  action?: ReactNode;
  description?: string;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  title: string;
}) {
  return (
    <View style={[styles.center, style]}>
      {icon ? <View style={styles.iconTile}>{icon}</View> : null}
      <Heading style={styles.centerText}>{title}</Heading>
      {description ? (
        <Muted style={[styles.centerText, styles.description]}>{description}</Muted>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({
  message = "Something went wrong. Please try again.",
  onRetry,
  retryLabel = "Retry",
  style,
}: {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View accessibilityRole="alert" style={[styles.center, style]}>
      <View style={[styles.iconTile, styles.iconTileDanger]}>
        <Feather color={colors.dangerDark} name="alert-circle" size={22} />
      </View>
      <Body style={[styles.centerText, styles.description]}>{message}</Body>
      {onRetry ? (
        <View style={styles.action}>
          <Button title={retryLabel} onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

export function Spinner({ label, size = "small", style }: { label?: string; size?: "large" | "small"; style?: StyleProp<ViewStyle> }) {
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" style={[styles.center, style]}>
      <ActivityIndicator color={colors.accent} size={size} />
      {label ? <Muted style={styles.spinnerLabel}>{label}</Muted> : null}
    </View>
  );
}

export function Skeleton({ height = 14, style, width }: { height?: number; style?: StyleProp<ViewStyle>; width?: number | `${number}%` }) {
  const breath = useBreathing(true, 1800);
  return <Animated.View style={[styles.skeleton, { height, opacity: breath, width: width ?? "100%" }, style]} />;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.lg },
  center: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
  centerText: { textAlign: "center" },
  description: { marginTop: spacing.xs, maxWidth: 300 },
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginVertical: spacing.md },
  iconTile: {
    alignItems: "center",
    backgroundColor: colors.zinc100,
    borderRadius: radius.lg,
    height: 48,
    justifyContent: "center",
    marginBottom: spacing.md,
    width: 48,
  },
  iconTileDanger: { backgroundColor: colors.dangerSoft },
  skeleton: { backgroundColor: colors.zinc100, borderRadius: radius.sm },
  spinnerLabel: { marginTop: spacing.sm },
});
