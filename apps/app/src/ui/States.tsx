import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";

import { colors, spacing } from "@/theme";
import { Button } from "./Button";
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
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Heading style={styles.centerText}>{title}</Heading>
      {description ? <Muted style={styles.centerText}>{description}</Muted> : null}
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
      <View style={styles.icon}>
        <Feather color={colors.danger} name="alert-circle" size={26} />
      </View>
      <Body style={styles.centerText}>{message}</Body>
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
      <ActivityIndicator color={colors.zinc500} size={size} />
      {label ? <Muted style={styles.spinnerLabel}>{label}</Muted> : null}
    </View>
  );
}

export function Skeleton({ height = 14, style, width }: { height?: number; style?: StyleProp<ViewStyle>; width?: number | `${number}%` }) {
  return <View style={[styles.skeleton, { height, width: width ?? "100%" }, style]} />;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.md },
  center: { alignItems: "center", justifyContent: "center", padding: spacing.xl },
  centerText: { marginTop: spacing.xs, textAlign: "center" },
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginVertical: spacing.md },
  icon: { marginBottom: spacing.sm },
  skeleton: { backgroundColor: colors.zinc200, borderRadius: 6 },
  spinnerLabel: { marginTop: spacing.sm },
});
