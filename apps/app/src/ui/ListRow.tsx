import type { ReactNode } from "react";
import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, spacing } from "@/theme";
import { Body, MonoSmall, Muted } from "./Text";

interface Props {
  accessibilityLabel?: string;
  chevron?: boolean;
  destructive?: boolean;
  left?: ReactNode;
  /** Mono line for measured data (ids, schedules, durations). */
  meta?: string;
  onPress?: () => void;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  subtitle?: ReactNode;
  testID?: string;
  title: ReactNode;
}

export function ListRow({
  accessibilityLabel,
  chevron,
  destructive = false,
  left,
  meta,
  onPress,
  right,
  style,
  subtitle,
  testID,
  title,
}: Props) {
  const showChevron = chevron ?? Boolean(onPress);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, style]}
      testID={testID}
      onPress={onPress}
    >
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.main}>
        {typeof title === "string" ? (
          <Body color={destructive ? colors.danger : colors.text} numberOfLines={2} style={styles.title}>
            {title}
          </Body>
        ) : (
          title
        )}
        {subtitle ? (
          typeof subtitle === "string" ? (
            <Muted numberOfLines={2} style={styles.subtitle}>
              {subtitle}
            </Muted>
          ) : (
            <View style={styles.subtitle}>{subtitle}</View>
          )
        ) : null}
        {meta ? (
          <MonoSmall numberOfLines={1} style={styles.meta}>
            {meta}
          </MonoSmall>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
      {showChevron ? <Feather color={colors.textSubtle} name="chevron-right" size={18} /> : null}
    </Pressable>
  );
}

export function RowGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.group, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  group: { gap: 0 },
  left: { marginRight: spacing.md },
  main: { flex: 1, gap: 2, minWidth: 0 },
  meta: { marginTop: 3 },
  pressed: { backgroundColor: colors.zinc50 },
  right: { alignItems: "flex-end", marginLeft: spacing.md },
  row: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  subtitle: { marginTop: 1 },
  title: { fontWeight: "500" },
});
