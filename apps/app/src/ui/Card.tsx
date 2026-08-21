import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius, spacing, type Tone, toneColors } from "@/theme";
import { Heading } from "./Text";

interface Props {
  action?: ReactNode;
  children?: ReactNode;
  padding?: "md" | "none" | "sm";
  style?: StyleProp<ViewStyle>;
  title?: string;
  tone?: Tone;
}

export function Card({ action, children, padding = "md", style, title, tone }: Props) {
  const toneStyle = tone ? { backgroundColor: toneColors[tone].bg, borderColor: toneColors[tone].border } : null;
  return (
    <View style={[styles.card, toneStyle, style]}>
      {title ? (
        <View style={[styles.header, padding === "none" && styles.headerPadded]}>
          <Heading style={styles.title}>{title}</Heading>
          {action}
        </View>
      ) : null}
      <View style={[padding === "md" && styles.padMd, padding === "sm" && styles.padSm, title && padding !== "none" && styles.noTop]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerPadded: { paddingBottom: spacing.md },
  noTop: { paddingTop: spacing.md },
  padMd: { padding: spacing.lg },
  padSm: { padding: spacing.md },
  title: { flexShrink: 1, fontSize: 15 },
});
