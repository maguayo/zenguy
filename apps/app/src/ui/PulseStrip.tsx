import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { palette, type Tone, toneSolid } from "@/theme";
import { useBreathing } from "./motion";

export interface PulseTick {
  key: string;
  tone: Tone;
}

interface Props {
  /** Breathe the newest tick: something is in progress right now. */
  live?: boolean;
  /** Number of slots; missing history renders as quiet placeholders. */
  max?: number;
  /** Colours for an ink (dark) background. */
  onInk?: boolean;
  size?: "md" | "sm";
  style?: StyleProp<ViewStyle>;
  /** Oldest first; the last tick is the most recent result. */
  ticks: PulseTick[];
}

/**
 * The signature: one tick per recent run or check, coloured by result, the
 * newest breathing while work is in progress. Order carries the history.
 */
export function PulseStrip({ live = false, max = 24, onInk = false, size = "md", style, ticks }: Props) {
  const breath = useBreathing(live);
  const recent = ticks.slice(-max);
  const placeholders = Math.max(0, max - recent.length);
  const placeholder = onInk ? palette.inkCard : palette.sand;
  const tickStyle = size === "sm" ? styles.tickSm : styles.tickMd;
  return (
    <View accessibilityElementsHidden style={[styles.row, style]}>
      {Array.from({ length: placeholders }, (_, index) => (
        <View key={`empty-${index}`} style={[tickStyle, { backgroundColor: placeholder, opacity: onInk ? 1 : 0.7 }]} />
      ))}
      {recent.map((tick, index) => {
        const newest = index === recent.length - 1;
        const color = toneSolid[tick.tone];
        return (
          <Animated.View
            key={tick.key}
            style={[tickStyle, { backgroundColor: color }, newest && live && { opacity: breath }]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 3 },
  tickMd: { borderRadius: 3, flex: 1, height: 18, maxWidth: 10, minWidth: 4 },
  tickSm: { borderRadius: 2, flex: 1, height: 12, maxWidth: 7, minWidth: 3 },
});
