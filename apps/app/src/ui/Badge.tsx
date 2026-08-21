import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { radius, type Tone, toneColors } from "@/theme";
import { Text } from "./Text";

interface Props {
  children: ReactNode;
  dot?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: Tone;
}

export function Badge({ children, dot = false, icon, style, tone = "neutral" }: Props) {
  const palette = toneColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg, borderColor: palette.border }, style]}>
      {icon}
      {dot ? <View style={[styles.dot, { backgroundColor: palette.fg }]} /> : null}
      <Text color={palette.fg} style={styles.text} variant="caption">
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dot: { borderRadius: 3, height: 6, width: 6 },
  text: { fontWeight: "500" },
});
