import type { ComponentProps, ReactNode } from "react";
import { Feather } from "@expo/vector-icons";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius, type Tone, toneColors } from "@/theme";

export type FeatherIconName = ComponentProps<typeof Feather>["name"];

interface Props {
  children?: ReactNode;
  icon?: FeatherIconName;
  /** Dark tile for the hero and primary rows. */
  ink?: boolean;
  round?: boolean;
  size?: 28 | 32 | 36 | 44 | 56;
  style?: StyleProp<ViewStyle>;
  tone?: Tone | "plain";
}

/** Rounded, tinted square that leads rows, stats and empty states. */
export function IconTile({ children, icon, ink = false, round = false, size = 36, style, tone = "plain" }: Props) {
  const bg = ink ? colors.ink : tone === "plain" ? colors.zinc100 : toneColors[tone].bg;
  const fg = ink ? colors.onInk : tone === "plain" ? colors.zinc600 : toneColors[tone].fg;
  const iconSize = size >= 44 ? 22 : size >= 36 ? 18 : 15;
  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: bg, borderRadius: round ? radius.full : size >= 44 ? radius.lg : radius.md, height: size, width: size },
        style,
      ]}
    >
      {children ?? (icon ? <Feather color={fg} name={icon} size={iconSize} /> : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
});
