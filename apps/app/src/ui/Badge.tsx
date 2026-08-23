import type { ReactNode } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { radius, type Tone, toneColors, toneSolid } from "@/theme";
import { useBreathing } from "./motion";
import { Text } from "./Text";

interface Props {
  children: ReactNode;
  dot?: boolean;
  icon?: ReactNode;
  /** Breathe the dot: the state is in progress (running, checking, open). */
  pulse?: boolean;
  size?: "md" | "sm";
  style?: StyleProp<ViewStyle>;
  tone?: Tone;
}

/** Status pill: tinted background, hairline, optional (breathing) dot. */
export function Badge({ children, dot = false, icon, pulse = false, size = "sm", style, tone = "neutral" }: Props) {
  const colors = toneColors[tone];
  const breath = useBreathing(dot && pulse);
  return (
    <View
      style={[
        styles.badge,
        size === "md" && styles.badgeMd,
        { backgroundColor: colors.bg, borderColor: colors.border },
        style,
      ]}
    >
      {icon}
      {dot ? (
        <Animated.View style={[styles.dot, { backgroundColor: toneSolid[tone], opacity: breath }]} />
      ) : null}
      <Text color={colors.fg} style={size === "md" ? styles.textMd : styles.text} variant="caption">
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
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeMd: { gap: 7, paddingHorizontal: 11, paddingVertical: 5 },
  dot: { borderRadius: 3, height: 6, width: 6 },
  text: { fontSize: 12, lineHeight: 16 },
  textMd: { fontSize: 13, lineHeight: 17 },
});
