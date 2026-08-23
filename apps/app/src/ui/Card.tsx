import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius, shadows, spacing, type Tone, toneColors } from "@/theme";
import { Eyebrow, Heading } from "./Text";

interface Props {
  action?: ReactNode;
  children?: ReactNode;
  /** Soft ink shadow; reserve for the primary card of a screen. */
  elevated?: boolean;
  /** Mono section label above the card. */
  eyebrow?: string;
  padding?: "lg" | "md" | "none" | "sm";
  style?: StyleProp<ViewStyle>;
  testID?: string;
  title?: string;
  tone?: Tone;
}

export function Card({
  action,
  children,
  elevated = false,
  eyebrow,
  padding = "md",
  style,
  testID,
  title,
  tone,
}: Props) {
  const toneStyle = tone ? { backgroundColor: toneColors[tone].bg, borderColor: toneColors[tone].border } : null;
  const card = (
    <View style={[styles.shadowWrap, elevated && shadows.card, !eyebrow && style]} testID={testID}>
      <View style={[styles.card, toneStyle]}>
        {title ? (
          <View style={[styles.header, padding === "none" && styles.headerPadded]}>
            <Heading style={styles.title}>{title}</Heading>
            {action}
          </View>
        ) : null}
        <View
          style={[
            padding === "lg" && styles.padLg,
            padding === "md" && styles.padMd,
            padding === "sm" && styles.padSm,
            title && padding !== "none" && styles.noTop,
          ]}
        >
          {children}
        </View>
      </View>
    </View>
  );
  if (!eyebrow) return card;
  return (
    <View style={style}>
      <View style={styles.eyebrowRow}>
        <Eyebrow>{eyebrow}</Eyebrow>
        {action && !title ? action : null}
      </View>
      {card}
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
  eyebrowRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
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
  padLg: { padding: spacing.xl },
  padMd: { padding: spacing.lg },
  padSm: { padding: spacing.md },
  shadowWrap: { borderRadius: radius.lg },
  title: { flexShrink: 1 },
});
