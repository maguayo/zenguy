import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius, spacing, type Tone, toneColors, toneSolid } from "@/theme";
import { Press } from "./Press";
import { Caption, Eyebrow, Text } from "./Text";

interface Props {
  hint?: string;
  label: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Danger/warn colour the number and show a dot; neutral stays quiet. */
  tone?: Tone | "neutral";
  value: number | string;
}

/** Compact figure with a mono label; loud only when its tone says so. */
export function StatTile({ hint, label, onPress, style, tone = "neutral", value }: Props) {
  const loud = tone !== "neutral";
  const color = loud ? toneColors[tone].fg : colors.text;
  const content = (
    <View style={[styles.tile, loud && { backgroundColor: toneColors[tone].bg, borderColor: toneColors[tone].border }]}>
      <View style={styles.labelRow}>
        {loud ? <View style={[styles.dot, { backgroundColor: toneSolid[tone] }]} /> : null}
        <Eyebrow color={loud ? toneColors[tone].fg : colors.textMuted} numberOfLines={1}>
          {label}
        </Eyebrow>
      </View>
      <Text color={color} numberOfLines={1} style={styles.value}>
        {value}
      </Text>
      {hint ? (
        <Caption color={loud ? toneColors[tone].fg : colors.textMuted} numberOfLines={1}>
          {hint}
        </Caption>
      ) : null}
    </View>
  );
  if (!onPress) return <View style={[styles.wrap, style]}>{content}</View>;
  return (
    <Press accessibilityRole="button" style={[styles.wrap, style]} onPress={onPress}>
      {content}
    </Press>
  );
}

const styles = StyleSheet.create({
  dot: { borderRadius: 3, height: 6, width: 6 },
  labelRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    minHeight: 84,
    padding: spacing.md + 2,
  },
  value: { fontSize: 26, fontWeight: "600", letterSpacing: -0.6, lineHeight: 32 },
  wrap: { flex: 1, minWidth: 0 },
});
